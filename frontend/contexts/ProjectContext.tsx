import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { Project, Asset, AssetTake, ViewType, ProjectTab, Timeline, ProjectDetails } from '../types/project'
import { createDefaultTimeline } from '../types/project'
import { logger } from '../lib/logger'
import { isWebMode } from '../lib/web-mode'
import { loadLibrary, saveLibrary } from '../lib/library'

interface ProjectContextType {
  // Navigation
  currentView: ViewType
  setCurrentView: (view: ViewType) => void
  currentProjectId: string | null
  setCurrentProjectId: (id: string | null) => void
  currentTab: ProjectTab
  setCurrentTab: (tab: ProjectTab) => void
  
  // Projects
  projects: Project[]
  currentProject: Project | null
  createProject: (details: ProjectDetails) => Project
  deleteProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  updateProject: (id: string, details: ProjectDetails) => void
  
  // Assets
  addAsset: (projectId: string, asset: Omit<Asset, 'id' | 'createdAt'>) => Asset
  deleteAsset: (projectId: string, assetId: string) => void
  updateAsset: (projectId: string, assetId: string, updates: Partial<Asset>) => void
  addTakeToAsset: (projectId: string, assetId: string, take: AssetTake) => void
  deleteTakeFromAsset: (projectId: string, assetId: string, takeIndex: number) => void
  setAssetActiveTake: (projectId: string, assetId: string, takeIndex: number) => void
  toggleFavorite: (projectId: string, assetId: string) => void
  
  // Playground assets (videos generated in the Playground, not tied to a project)
  playgroundAssets: Asset[]
  addPlaygroundAsset: (asset: Omit<Asset, 'id' | 'createdAt'>) => Asset
  deletePlaygroundAsset: (assetId: string) => void
  togglePlaygroundFavorite: (assetId: string) => void
  
  // Timelines
  addTimeline: (projectId: string, name?: string) => Timeline
  deleteTimeline: (projectId: string, timelineId: string) => void
  renameTimeline: (projectId: string, timelineId: string, name: string) => void
  duplicateTimeline: (projectId: string, timelineId: string) => Timeline | null
  setActiveTimeline: (projectId: string, timelineId: string) => void
  updateTimeline: (projectId: string, timelineId: string, updates: Partial<Pick<Timeline, 'tracks' | 'clips' | 'subtitles'>>) => void
  getActiveTimeline: (projectId: string) => Timeline | null
  
  // Navigation helpers
  openProject: (id: string) => void
  goHome: () => void
  openPlayground: () => void
  
  // Cross-view communication (editor → gen space)
  genSpaceEditImageUrl: string | null
  setGenSpaceEditImageUrl: (url: string | null) => void
  genSpaceEditMode: 'image' | 'video' | null
  setGenSpaceEditMode: (mode: 'image' | 'video' | null) => void
  genSpaceAudioUrl: string | null
  setGenSpaceAudioUrl: (url: string | null) => void
  genSpaceRetakeSource: GenSpaceRetakeSource | null
  setGenSpaceRetakeSource: (source: GenSpaceRetakeSource | null) => void
  pendingRetakeUpdate: PendingRetakeUpdate | null
  setPendingRetakeUpdate: (update: PendingRetakeUpdate | null) => void
  genSpaceIcLoraSource: GenSpaceIcLoraSource | null
  setGenSpaceIcLoraSource: (source: GenSpaceIcLoraSource | null) => void
  pendingIcLoraUpdate: PendingIcLoraUpdate | null
  setPendingIcLoraUpdate: (update: PendingIcLoraUpdate | null) => void
}

export interface GenSpaceRetakeSource {
  videoUrl: string
  videoPath: string
  clipId?: string
  assetId?: string
  linkedClipIds?: string[]
  duration?: number
}

export interface PendingRetakeUpdate {
  assetId: string
  clipIds: string[]
  newTakeIndex: number
}

export interface GenSpaceIcLoraSource {
  videoUrl: string
  videoPath: string
  clipId?: string
  assetId?: string
  linkedClipIds?: string[]
}

export interface PendingIcLoraUpdate {
  assetId: string
  clipIds: string[]
  newTakeIndex: number
}

const ProjectContext = createContext<ProjectContextType | null>(null)

const STORAGE_KEY = 'ltx-projects'
const PLAYGROUND_STORAGE_KEY = 'ltx-playground-assets'

// Folder name used when copying Playground-generated videos into the shared
// assets directory. Distinct from real project IDs (which are `project-...`).
export const PLAYGROUND_ASSET_FOLDER = 'playground'

// Migrate old projects that don't have timelines
function migrateProject(project: Project): Project {
  if (!project.timelines) {
    return {
      ...project,
      timelines: [createDefaultTimeline('Timeline 1')],
      activeTimelineId: undefined, // will be set on first access
    }
  }
  return project
}

// Rebuild a file:// URL from a filesystem path
function pathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}

// Check if a path looks like a real filesystem path (not just a filename)
function isRealPath(p: string): boolean {
  if (!p) return false
  // Has directory separators or starts with a drive letter (Windows) or /
  return p.includes('/') || p.includes('\\') || /^[A-Za-z]:/.test(p)
}

// Recover broken blob URLs by rebuilding file:// URLs from stored paths
function recoverAssetUrls(project: Project): Project {
  let changed = false
  const fixedAssets = project.assets.map(asset => {
    // If the URL is a blob: URL and we have a real file path, recover it
    if (asset.url && asset.url.startsWith('blob:') && isRealPath(asset.path)) {
      changed = true
      const fixedUrl = pathToFileUrl(asset.path)
      const fixedTakes = asset.takes?.map(t => ({
        ...t,
        url: t.url.startsWith('blob:') && isRealPath(t.path) ? pathToFileUrl(t.path) : t.url
      }))
      return { ...asset, url: fixedUrl, takes: fixedTakes || asset.takes }
    }
    return asset
  })
  
  if (!changed) return project
  
  // Also fix clip embedded assets and timeline clip references
  const fixedTimelines = project.timelines?.map(tl => ({
    ...tl,
    clips: tl.clips?.map(clip => {
      if (clip.asset?.url?.startsWith('blob:') && isRealPath(clip.asset.path)) {
        return { ...clip, asset: { ...clip.asset, url: pathToFileUrl(clip.asset.path) } }
      }
      return clip
    }) || tl.clips
  }))
  
  return { ...project, assets: fixedAssets, timelines: fixedTimelines || project.timelines }
}

// Load initial projects from localStorage synchronously
function loadProjectsFromStorage(): Project[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        // Migrate any old projects, then recover broken blob URLs
        return parsed.map(migrateProject).map(recoverAssetUrls)
      }
    }
  } catch (e) {
    logger.error(`Failed to load projects: ${e}`)
  }
  return []
}

// Load playground assets from localStorage, recovering broken blob URLs
function loadPlaygroundAssetsFromStorage(): Asset[] {
  try {
    const stored = localStorage.getItem(PLAYGROUND_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        return parsed.map((asset: Asset) =>
          asset.url && asset.url.startsWith('blob:') && isRealPath(asset.path)
            ? { ...asset, url: pathToFileUrl(asset.path) }
            : asset
        )
      }
    }
  } catch (e) {
    logger.error(`Failed to load playground assets: ${e}`)
  }
  return []
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [currentView, setCurrentView] = useState<ViewType>('home')
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const [currentTab, setCurrentTab] = useState<ProjectTab>('gen-space')
  const [genSpaceEditImageUrl, setGenSpaceEditImageUrl] = useState<string | null>(null)
  const [genSpaceEditMode, setGenSpaceEditMode] = useState<'image' | 'video' | null>(null)
  const [genSpaceAudioUrl, setGenSpaceAudioUrl] = useState<string | null>(null)
  const [genSpaceRetakeSource, setGenSpaceRetakeSource] = useState<GenSpaceRetakeSource | null>(null)
  const [pendingRetakeUpdate, setPendingRetakeUpdate] = useState<PendingRetakeUpdate | null>(null)
  const [genSpaceIcLoraSource, setGenSpaceIcLoraSource] = useState<GenSpaceIcLoraSource | null>(null)
  const [pendingIcLoraUpdate, setPendingIcLoraUpdate] = useState<PendingIcLoraUpdate | null>(null)
  // Initialize with data from localStorage
  const [projects, setProjects] = useState<Project[]>(() => (isWebMode() ? [] : loadProjectsFromStorage()))
  const [playgroundAssets, setPlaygroundAssets] = useState<Asset[]>(() => (isWebMode() ? [] : loadPlaygroundAssetsFromStorage()))
  const isInitializedRef = useRef(false)
  const webReadyRef = useRef(false)
  const librarySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mark as initialized after first render.
  // Desktop is ready immediately (localStorage loaded synchronously above).
  // Web/self-hosted hydrates from the backend project library, then enables
  // saving. Saving is gated on a *successful* load so a transient fetch error
  // can never overwrite existing server data with an empty snapshot.
  useEffect(() => {
    if (!isWebMode()) {
      isInitializedRef.current = true
      return
    }
    let cancelled = false
    void (async () => {
      const snapshot = await loadLibrary()
      if (!cancelled && snapshot) {
        setProjects((snapshot.projects as Project[]).map(migrateProject).map(recoverAssetUrls))
        setPlaygroundAssets(snapshot.playgroundAssets as Asset[])
        webReadyRef.current = true
      }
      isInitializedRef.current = true
    })()
    return () => {
      cancelled = true
    }
  }, [])
  
  // Save projects to localStorage when changed (but not on initial load)
  useEffect(() => {
    // Skip saving on initial render to avoid overwriting with stale data
    if (!isInitializedRef.current) return
    if (isWebMode()) return // Web persists via the backend library (effect below)
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
      logger.info(`Projects saved: ${projects.length}`)
    } catch (e) {
      logger.error(`Failed to save projects: ${e}`)
    }
  }, [projects])
  
  // Save playground assets to localStorage when changed (but not on initial load)
  useEffect(() => {
    if (!isInitializedRef.current) return
    if (isWebMode()) return // Web persists via the backend library (effect below)
    try {
      localStorage.setItem(PLAYGROUND_STORAGE_KEY, JSON.stringify(playgroundAssets))
    } catch (e) {
      logger.error(`Failed to save playground assets: ${e}`)
    }
  }, [playgroundAssets])

  // Web/self-hosted: persist the full library to the backend (debounced) so
  // projects and Playground assets survive container restarts when --data-dir
  // is mounted. Gated on a successful initial load (webReadyRef).
  useEffect(() => {
    if (!isInitializedRef.current || !isWebMode() || !webReadyRef.current) return
    if (librarySaveTimerRef.current) clearTimeout(librarySaveTimerRef.current)
    librarySaveTimerRef.current = setTimeout(() => {
      void saveLibrary({ projects, playgroundAssets })
    }, 500)
    return () => {
      if (librarySaveTimerRef.current) clearTimeout(librarySaveTimerRef.current)
    }
  }, [projects, playgroundAssets])
  
  const currentProject = projects.find(p => p.id === currentProjectId) || null
  
  const createProject = useCallback((details: ProjectDetails): Project => {
    const defaultTimeline = createDefaultTimeline('Timeline 1')
    const newProject: Project = {
      id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: details.name.trim(),
      description: details.description?.trim() || undefined,
      coverImage: details.coverImage || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assets: [],
      timelines: [defaultTimeline],
      activeTimelineId: defaultTimeline.id,
    }
    setProjects(prev => [newProject, ...prev])
    return newProject
  }, [])
  
  const deleteProject = useCallback((id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id))
    if (currentProjectId === id) {
      setCurrentProjectId(null)
      setCurrentView('home')
    }
  }, [currentProjectId])
  
  const renameProject = useCallback((id: string, name: string) => {
    setProjects(prev => prev.map(p => 
      p.id === id ? { ...p, name, updatedAt: Date.now() } : p
    ))
  }, [])

  // Updates the editable project details (name, description, cover image).
  // The cover image is independent from the asset-derived `thumbnail` fallback.
  const updateProject = useCallback((id: string, details: ProjectDetails) => {
    setProjects(prev => prev.map(p => 
      p.id === id
        ? {
            ...p,
            name: details.name.trim(),
            description: details.description?.trim() || undefined,
            coverImage: details.coverImage || undefined,
            updatedAt: Date.now(),
          }
        : p
    ))
  }, [])

  const addAsset = useCallback((projectId: string, assetData: Omit<Asset, 'id' | 'createdAt'>): Asset => {
    const newAsset: Asset = {
      ...assetData,
      id: `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
    }
    setProjects(prev => prev.map(p => 
      p.id === projectId 
        ? { 
            ...p, 
            assets: [newAsset, ...p.assets],
            updatedAt: Date.now(),
            thumbnail: p.thumbnail || newAsset.thumbnail || newAsset.url,
          } 
        : p
    ))
    return newAsset
  }, [])
  
  const deleteAsset = useCallback((projectId: string, assetId: string) => {
    setProjects(prev => prev.map(p => 
      p.id === projectId 
        ? { ...p, assets: p.assets.filter(a => a.id !== assetId), updatedAt: Date.now() } 
        : p
    ))
  }, [])
  
  const updateAsset = useCallback((projectId: string, assetId: string, updates: Partial<Asset>) => {
    setProjects(prev => prev.map(p =>
      p.id === projectId
        ? {
            ...p,
            assets: p.assets.map(a =>
              a.id === assetId ? { ...a, ...updates } : a
            ),
            updatedAt: Date.now(),
          }
        : p
    ))
  }, [])

  const addTakeToAsset = useCallback((projectId: string, assetId: string, take: AssetTake) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p
      return {
        ...p,
        assets: p.assets.map(a => {
          if (a.id !== assetId) return a
          // Initialize takes array if it doesn't exist (original asset becomes take 0)
          const existingTakes: AssetTake[] = a.takes || [{
            url: a.url,
            path: a.path,
            thumbnail: a.thumbnail,
            createdAt: a.createdAt,
          }]
          const newTakes = [...existingTakes, take]
          const newIndex = newTakes.length - 1
          return {
            ...a,
            takes: newTakes,
            activeTakeIndex: newIndex,
            // Update the main url/path to the new take
            url: take.url,
            path: take.path,
            thumbnail: take.thumbnail || a.thumbnail,
          }
        }),
        updatedAt: Date.now(),
      }
    }))
  }, [])

  const deleteTakeFromAsset = useCallback((projectId: string, assetId: string, takeIndex: number) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p
      return {
        ...p,
        assets: p.assets.map(a => {
          if (a.id !== assetId || !a.takes || a.takes.length <= 1) return a // Never delete the last take
          const newTakes = a.takes.filter((_, i) => i !== takeIndex)
          // Adjust activeTakeIndex
          let newActiveIdx = a.activeTakeIndex ?? newTakes.length - 1
          if (newActiveIdx >= newTakes.length) newActiveIdx = newTakes.length - 1
          if (newActiveIdx < 0) newActiveIdx = 0
          const activeTake = newTakes[newActiveIdx]
          return {
            ...a,
            takes: newTakes,
            activeTakeIndex: newActiveIdx,
            url: activeTake.url,
            path: activeTake.path,
            thumbnail: activeTake.thumbnail || a.thumbnail,
          }
        }),
        updatedAt: Date.now(),
      }
    }))
  }, [])

  const setAssetActiveTake = useCallback((projectId: string, assetId: string, takeIndex: number) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p
      return {
        ...p,
        assets: p.assets.map(a => {
          if (a.id !== assetId || !a.takes) return a
          const idx = Math.max(0, Math.min(takeIndex, a.takes.length - 1))
          const take = a.takes[idx]
          return {
            ...a,
            activeTakeIndex: idx,
            url: take.url,
            path: take.path,
            thumbnail: take.thumbnail || a.thumbnail,
          }
        }),
        updatedAt: Date.now(),
      }
    }))
  }, [])

  const toggleFavorite = useCallback((projectId: string, assetId: string) => {
    setProjects(prev => prev.map(p => 
      p.id === projectId 
        ? { 
            ...p, 
            assets: p.assets.map(a => 
              a.id === assetId ? { ...a, favorite: !a.favorite } : a
            ),
            updatedAt: Date.now(),
          } 
        : p
    ))
  }, [])
  
  // --- Playground assets ---
  
  const addPlaygroundAsset = useCallback((assetData: Omit<Asset, 'id' | 'createdAt'>): Asset => {
    const newAsset: Asset = {
      ...assetData,
      id: `pg-asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
    }
    setPlaygroundAssets(prev => [newAsset, ...prev])
    return newAsset
  }, [])
  
  const deletePlaygroundAsset = useCallback((assetId: string) => {
    setPlaygroundAssets(prev => prev.filter(a => a.id !== assetId))
  }, [])
  
  const togglePlaygroundFavorite = useCallback((assetId: string) => {
    setPlaygroundAssets(prev => prev.map(a => 
      a.id === assetId ? { ...a, favorite: !a.favorite } : a
    ))
  }, [])
  
  // --- Timeline CRUD ---
  
  const addTimeline = useCallback((projectId: string, name?: string): Timeline => {
    const project = projects.find(p => p.id === projectId)
    const count = (project?.timelines?.length || 0) + 1
    const newTimeline = createDefaultTimeline(name || `Timeline ${count}`)
    
    setProjects(prev => prev.map(p => 
      p.id === projectId 
        ? { 
            ...p, 
            timelines: [...(p.timelines || []), newTimeline],
            activeTimelineId: newTimeline.id,
            updatedAt: Date.now(),
          } 
        : p
    ))
    return newTimeline
  }, [projects])
  
  const deleteTimeline = useCallback((projectId: string, timelineId: string) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p
      const remaining = (p.timelines || []).filter(t => t.id !== timelineId)
      // Don't allow deleting the last timeline
      if (remaining.length === 0) return p
      return {
        ...p,
        timelines: remaining,
        // If we deleted the active timeline, switch to the first remaining
        activeTimelineId: p.activeTimelineId === timelineId ? remaining[0].id : p.activeTimelineId,
        updatedAt: Date.now(),
      }
    }))
  }, [])
  
  const renameTimeline = useCallback((projectId: string, timelineId: string, name: string) => {
    setProjects(prev => prev.map(p => 
      p.id === projectId 
        ? {
            ...p,
            timelines: (p.timelines || []).map(t => 
              t.id === timelineId ? { ...t, name } : t
            ),
            updatedAt: Date.now(),
          }
        : p
    ))
  }, [])
  
  const duplicateTimeline = useCallback((projectId: string, timelineId: string): Timeline | null => {
    const project = projects.find(p => p.id === projectId)
    const source = project?.timelines?.find(t => t.id === timelineId)
    if (!source) return null
    
    const newTimeline: Timeline = {
      ...source,
      id: `timeline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: `${source.name} (copy)`,
      createdAt: Date.now(),
      tracks: source.tracks.map(t => ({ ...t })),
      clips: source.clips.map(c => ({ 
        ...c, 
        id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` 
      })),
      subtitles: source.subtitles?.map(s => ({
        ...s,
        id: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      })),
    }
    
    setProjects(prev => prev.map(p => 
      p.id === projectId 
        ? { 
            ...p, 
            timelines: [...(p.timelines || []), newTimeline],
            activeTimelineId: newTimeline.id,
            updatedAt: Date.now(),
          }
        : p
    ))
    return newTimeline
  }, [projects])
  
  const setActiveTimeline = useCallback((projectId: string, timelineId: string) => {
    setProjects(prev => prev.map(p => 
      p.id === projectId ? { ...p, activeTimelineId: timelineId } : p
    ))
  }, [])
  
  const updateTimeline = useCallback((projectId: string, timelineId: string, updates: Partial<Pick<Timeline, 'tracks' | 'clips' | 'subtitles'>>) => {
    setProjects(prev => prev.map(p => 
      p.id === projectId 
        ? {
            ...p,
            timelines: (p.timelines || []).map(t => 
              t.id === timelineId ? { ...t, ...updates } : t
            ),
            updatedAt: Date.now(),
          }
        : p
    ))
  }, [])
  
  const getActiveTimeline = useCallback((projectId: string): Timeline | null => {
    const project = projects.find(p => p.id === projectId)
    if (!project || !project.timelines || project.timelines.length === 0) return null
    
    // Find the active timeline, or fall back to the first one
    const active = project.timelines.find(t => t.id === project.activeTimelineId)
    return active || project.timelines[0]
  }, [projects])
  
  const openProject = useCallback((id: string) => {
    setCurrentProjectId(id)
    setCurrentView('project')
    setCurrentTab('gen-space')
  }, [])
  
  const goHome = useCallback(() => {
    setCurrentView('home')
    setCurrentProjectId(null)
  }, [])
  
  const openPlayground = useCallback(() => {
    setCurrentView('playground')
  }, [])
  
  return (
    <ProjectContext.Provider value={{
      currentView,
      setCurrentView,
      currentProjectId,
      setCurrentProjectId,
      currentTab,
      setCurrentTab,
      projects,
      currentProject,
      createProject,
      deleteProject,
      renameProject,
      updateProject,
      addAsset,
      deleteAsset,
      updateAsset,
      addTakeToAsset,
      deleteTakeFromAsset,
      setAssetActiveTake,
      toggleFavorite,
      playgroundAssets,
      addPlaygroundAsset,
      deletePlaygroundAsset,
      togglePlaygroundFavorite,
      addTimeline,
      deleteTimeline,
      renameTimeline,
      duplicateTimeline,
      setActiveTimeline,
      updateTimeline,
      getActiveTimeline,
      openProject,
      goHome,
      openPlayground,
      genSpaceEditImageUrl,
      setGenSpaceEditImageUrl,
      genSpaceEditMode,
      setGenSpaceEditMode,
      genSpaceAudioUrl,
      setGenSpaceAudioUrl,
      genSpaceRetakeSource,
      setGenSpaceRetakeSource,
      pendingRetakeUpdate,
      setPendingRetakeUpdate,
      genSpaceIcLoraSource,
      setGenSpaceIcLoraSource,
      pendingIcLoraUpdate,
      setPendingIcLoraUpdate,
    }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProjects() {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error('useProjects must be used within a ProjectProvider')
  }
  return context
}
