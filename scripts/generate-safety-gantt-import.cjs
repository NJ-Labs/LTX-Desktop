const path = require('path');

function requireFromWorkspace(moduleName) {
  try {
    return require(moduleName);
  } catch (error) {
    const fallbackPath = path.resolve(__dirname, '..', '..', 'Newsletter', 'node_modules', moduleName);
    return require(fallbackPath);
  }
}

const ExcelJS = requireFromWorkspace('exceljs');

const outputPath = path.resolve(__dirname, '..', 'ltx-safety-video-gantts-import-he.xlsx');

const projects = [
  {
    id: 'safety-videos',
    title: 'מפת דרכים ליצירת סרטוני בטיחות',
    department: 'בטיחות והדרכה',
    division: 'מודעות ומניעת סיכונים',
    field: 'יצירת סרטוני בטיחות לצמצום מפגעים והגברת מודעות',
    description: 'מפת דרכים ניהולית המבוססת על קומיטים מ-2026-03-05 עד 2026-06-24, עם המשך עד ספטמבר לטובת הטמעה, פיילוט ואישור.',
    status: 'In Progress',
    due: '2026-09-30',
    roles: [
      ['מנהל מוצר בטיחות', 0, 'monthly', 'ILS'],
      ['מוביל תוכן בטיחות', 0, 'monthly', 'ILS'],
      ['מומחה וידאו AI', 0, 'monthly', 'ILS'],
      ['מפתח אפליקציה', 0, 'monthly', 'ILS'],
      ['מוביל בדיקות והטמעה', 0, 'monthly', 'ILS'],
    ],
    resources: [
      ['אחראי מוצר', 'מנהל מוצר בטיחות', '#D93A3A', 100],
      ['אחראי תוכן בטיחות', 'מוביל תוכן בטיחות', '#2563EB', 100],
      ['צוות יצירת וידאו', 'מומחה וידאו AI', '#059669', 100],
      ['צוות אפליקציה', 'מפתח אפליקציה', '#7C3AED', 100],
      ['רכז הטמעה', 'מוביל בדיקות והטמעה', '#EA580C', 100],
    ],
    goals: [
      ['אב טיפוס ראשון לסרטון בטיחות מוכן', '2026-03-05', 100, 'completed'],
      ['ניהול נכסי וידאו יציב ומוכן לעבודה', '2026-03-11', 100, 'completed'],
      ['שיפור יצירה וגלריית תוצרים מוכנים', '2026-06-22', 100, 'completed'],
      ['אישור מנהלים להטמעת סרטוני בטיחות', '2026-09-30', 0, 'pending'],
    ],
    tasks: [
      ['1', 'יסודות יצירת סרטוני בטיחות', '2026-03-05', 3, 100, 'Completed', 'No', 'אחראי מוצר', ''],
      ['1.1', 'הגדרת תהליך יצירת סרטון בטיחות', '2026-03-05', 1, 100, 'Completed', 'No', 'אחראי מוצר', ''],
      ['1.2', 'תמיכה בווידאו אנכי להדרכות במסכים ובטלפון', '2026-03-05', 1, 100, 'Completed', 'No', 'צוות יצירת וידאו', '1.1'],
      ['1.3', 'בחירה בין יצירה מקומית לבין יצירה דרך API', '2026-03-05', 1, 100, 'Completed', 'No', 'צוות אפליקציה', '1.2'],
      ['1.4', 'אפשרות ליצירת גרסה חוזרת לסרטון שלא מספיק ברור', '2026-03-05', 1, 100, 'Completed', 'No', 'אחראי תוכן בטיחות', '1.3'],
      ['1.5', 'אבן דרך: אב טיפוס ראשון לסרטון בטיחות', '2026-03-05', 0, 100, 'Completed', 'Yes', 'אחראי מוצר', '1.4'],
      ['2', 'שיפור חוויית יצירה למשתמשי בטיחות', '2026-03-05', 5, 100, 'Completed', 'No', 'צוות אפליקציה', '1.5'],
      ['2.1', 'הצגת סטטוס יצירה פשוט וברור', '2026-03-05', 1, 100, 'Completed', 'No', 'צוות אפליקציה', '1.5'],
      ['2.2', 'הסרת מידע טכני שמבלבל משתמשים עסקיים', '2026-03-05', 1, 100, 'Completed', 'No', 'אחראי מוצר', '2.1'],
      ['2.3', 'הצגת מידע על מפתח API חינמי ליצירת וידאו', '2026-03-05', 1, 100, 'Completed', 'No', 'אחראי מוצר', '2.2'],
      ['2.4', 'עדכון מסלולי מודל הווידאו לגרסה עדכנית', '2026-03-05', 1, 100, 'Completed', 'No', 'צוות יצירת וידאו', '2.3'],
      ['2.5', 'אבן דרך: תהליך יצירת וידאו ברור למשתמש', '2026-03-05', 0, 100, 'Completed', 'Yes', 'אחראי מוצר', '2.4'],
      ['3', 'ניהול תוצרי וידאו ותיקיות עבודה', '2026-03-07', 6, 100, 'Completed', 'No', 'רכז הטמעה', '2.5'],
      ['3.1', 'שמירת תוצרים בתיקיית האפליקציה', '2026-03-07', 1, 100, 'Completed', 'No', 'צוות אפליקציה', '2.5'],
      ['3.2', 'חיבור לוגים של המערכת למסך האפליקציה', '2026-03-08', 1, 100, 'Completed', 'No', 'רכז הטמעה', '3.1'],
      ['3.3', 'הפרדת נכסים לפי פרויקט בטיחות', '2026-03-08', 1, 100, 'Completed', 'No', 'צוות אפליקציה', '3.2'],
      ['3.4', 'הוספת מחיקה עדינה של סרטונים לא רלוונטיים', '2026-03-09', 1, 100, 'Completed', 'No', 'אחראי תוכן בטיחות', '3.3'],
      ['3.5', 'יישור תיעוד דרישות מקום בדיסק', '2026-03-11', 1, 100, 'Completed', 'No', 'רכז הטמעה', '3.4'],
      ['3.6', 'אבן דרך: ניהול נכסי וידאו מוכן לעבודה', '2026-03-11', 0, 100, 'Completed', 'Yes', 'רכז הטמעה', '3.5'],
      ['4', 'גלריית תוצרים ושיפור יצירה', '2026-06-15', 8, 100, 'Completed', 'No', 'צוות יצירת וידאו', '3.6'],
      ['4.1', 'הוספת סימון שיפור לתוצרי וידאו', '2026-06-15', 1, 100, 'Completed', 'No', 'צוות אפליקציה', '3.6'],
      ['4.2', 'בניית גלריה לתוצרי וידאו', '2026-06-15', 2, 100, 'Completed', 'No', 'צוות אפליקציה', '4.1'],
      ['4.3', 'שיפור טיפול בשגיאות יצירה', '2026-06-22', 1, 100, 'Completed', 'No', 'רכז הטמעה', '4.2'],
      ['4.4', 'חיזוק החיבור בין מרחב היצירה, הפלייגראונד והשרת', '2026-06-22', 2, 100, 'Completed', 'No', 'צוות אפליקציה', '4.3'],
      ['4.5', 'אבן דרך: גלריית סרטוני בטיחות מוכנה', '2026-06-22', 0, 100, 'Completed', 'Yes', 'אחראי תוכן בטיחות', '4.4'],
      ['5', 'תבניות וסביבות עבודה לסרטוני בטיחות', '2026-06-24', 18, 100, 'Completed', 'No', 'צוות יצירת וידאו', '4.5'],
      ['5.1', 'שילוב ComfyUI לזרימות עבודה מתקדמות', '2026-06-24', 2, 100, 'Completed', 'No', 'צוות יצירת וידאו', '4.5'],
      ['5.2', 'תיקון מאפייני מדיה של LTXVideo', '2026-06-24', 1, 100, 'Completed', 'No', 'צוות יצירת וידאו', '5.1'],
      ['5.3', 'הגדרת ספריית תרחישי סיכון לדוגמה', '2026-07-01', 5, 0, 'Pending', 'No', 'אחראי תוכן בטיחות', '5.2'],
      ['5.4', 'יצירת תבניות למסרים קצרים וברורים לעובדים', '2026-07-08', 8, 0, 'Pending', 'No', 'אחראי תוכן בטיחות', '5.3'],
      ['5.5', 'אבן דרך: ספריית תבניות בטיחות ראשונה', '2026-07-17', 0, 0, 'Pending', 'Yes', 'אחראי מוצר', '5.4'],
      ['6', 'פיילוט והטמעה בארגון', '2026-07-20', 53, 0, 'Pending', 'No', 'רכז הטמעה', '5.5'],
      ['6.1', 'בחירת שלושה תרחישי סיכון לפיילוט', '2026-07-20', 5, 0, 'Pending', 'No', 'אחראי מוצר', '5.5'],
      ['6.2', 'יצירת סרטוני פיילוט והצגתם למנהלים', '2026-07-27', 10, 0, 'Pending', 'No', 'צוות יצירת וידאו', '6.1'],
      ['6.3', 'איסוף משוב ממנהלים ועובדים', '2026-08-10', 10, 0, 'Pending', 'No', 'רכז הטמעה', '6.2'],
      ['6.4', 'שיפור הסרטונים לפי משוב והכנת ערכת הפצה', '2026-08-24', 15, 0, 'Pending', 'No', 'אחראי תוכן בטיחות', '6.3'],
      ['6.5', 'הדרכת צוותי בטיחות לשימוש עצמאי', '2026-09-14', 10, 0, 'Pending', 'No', 'רכז הטמעה', '6.4'],
      ['6.6', 'אבן דרך: אישור מנהלים להטמעת סרטוני בטיחות', '2026-09-30', 0, 0, 'Pending', 'Yes', 'אחראי מוצר', '6.5'],
    ],
  },
  {
    id: 'desktop-platform',
    title: 'מפת דרכים לפלטפורמת יצירת וידאו שולחנית',
    department: 'פלטפורמת וידאו',
    division: 'תשתית מוצר',
    field: 'אפליקציית דסקטופ אמינה ליצירת סרטוני בטיחות',
    description: 'מפת דרכים ניהולית לתשתית הדסקטופ שמאפשרת יצירת סרטוני בטיחות אמינה, מקומית או דרך API, עם פריסה עד ספטמבר.',
    status: 'In Progress',
    due: '2026-09-30',
    roles: [
      ['מנהל מוצר', 0, 'monthly', 'ILS'],
      ['מוביל פלטפורמה', 0, 'monthly', 'ILS'],
      ['מפתח דסקטופ', 0, 'monthly', 'ILS'],
      ['מפתח Backend ו-AI', 0, 'monthly', 'ILS'],
      ['מוביל DevOps והפצה', 0, 'monthly', 'ILS'],
    ],
    resources: [
      ['אחראי מוצר', 'מנהל מוצר', '#D93A3A', 100],
      ['אחראי פלטפורמה', 'מוביל פלטפורמה', '#2563EB', 100],
      ['צוות דסקטופ', 'מפתח דסקטופ', '#059669', 100],
      ['צוות Backend ו-AI', 'מפתח Backend ו-AI', '#7C3AED', 100],
      ['צוות הפצה', 'מוביל DevOps והפצה', '#EA580C', 100],
    ],
    goals: [
      ['מנוע יצירת וידאו יציב', '2026-03-05', 100, 'completed'],
      ['אפליקציית דסקטופ יציבה ומבודדת', '2026-03-11', 100, 'completed'],
      ['תמיכה בהפצה רחבה ואייר-גאפ', '2026-03-22', 100, 'completed'],
      ['פלטפורמה מאושרת לשימוש ארגוני', '2026-09-30', 0, 'pending'],
    ],
    tasks: [
      ['1', 'יסודות מנוע יצירת הווידאו', '2026-03-05', 4, 100, 'Completed', 'No', 'צוות Backend ו-AI', ''],
      ['1.1', 'התאמת דרישות זיכרון GPU למחשבי עבודה', '2026-03-05', 1, 100, 'Completed', 'No', 'צוות Backend ו-AI', ''],
      ['1.2', 'ניקוי שגיאות בדיקות ופיתוח', '2026-03-05', 1, 100, 'Completed', 'No', 'צוות Backend ו-AI', '1.1'],
      ['1.3', 'ייצוב הורדת מודלים והתקדמות הורדה', '2026-03-05', 1, 100, 'Completed', 'No', 'צוות Backend ו-AI', '1.2'],
      ['1.4', 'צמצום מסלולים לא נחוצים כדי להפחית סיכון', '2026-03-05', 1, 100, 'Completed', 'No', 'אחראי פלטפורמה', '1.3'],
      ['1.5', 'תיקון עומסי זיכרון ביצירת גרסאות חוזרות', '2026-03-05', 1, 100, 'Completed', 'No', 'צוות Backend ו-AI', '1.4'],
      ['1.6', 'אבן דרך: מנוע וידאו יציב לגרסה ראשונה', '2026-03-05', 0, 100, 'Completed', 'Yes', 'אחראי פלטפורמה', '1.5'],
      ['2', 'יציבות אפליקציית הדסקטופ', '2026-03-07', 6, 100, 'Completed', 'No', 'צוות דסקטופ', '1.6'],
      ['2.1', 'שמירת תוצרים במיקום אפליקציה מסודר', '2026-03-07', 1, 100, 'Completed', 'No', 'צוות דסקטופ', '1.6'],
      ['2.2', 'הזרמת לוגים של השרת לאפליקציה', '2026-03-08', 1, 100, 'Completed', 'No', 'צוות דסקטופ', '2.1'],
      ['2.3', 'בידוד Python ארוז מתלויות המחשב', '2026-03-08', 1, 100, 'Completed', 'No', 'צוות דסקטופ', '2.2'],
      ['2.4', 'מניעת התנגשויות פורטים והוספת אימות', '2026-03-09', 1, 100, 'Completed', 'No', 'צוות Backend ו-AI', '2.3'],
      ['2.5', 'תיעוד גרסת האפליקציה לצורך תמיכה', '2026-03-11', 1, 100, 'Completed', 'No', 'צוות דסקטופ', '2.4'],
      ['2.6', 'אבן דרך: דסקטופ יציב לסביבת עבודה', '2026-03-11', 0, 100, 'Completed', 'Yes', 'אחראי פלטפורמה', '2.5'],
      ['3', 'הפצה למערכות הפעלה ותמיכה בארגון', '2026-03-09', 12, 100, 'Completed', 'No', 'צוות הפצה', '2.6'],
      ['3.1', 'הוספת תמיכה בלינוקס', '2026-03-09', 2, 100, 'Completed', 'No', 'צוות הפצה', '2.6'],
      ['3.2', 'תיקון זיהוי ffmpeg ותסריטי התקנה', '2026-03-09', 1, 100, 'Completed', 'No', 'צוות הפצה', '3.1'],
      ['3.3', 'הוספת סביבת Docker לבניית חבילות לינוקס', '2026-03-09', 2, 100, 'Completed', 'No', 'צוות הפצה', '3.2'],
      ['3.4', 'תמיכה בלינוקס arm64', '2026-03-10', 2, 100, 'Completed', 'No', 'צוות הפצה', '3.3'],
      ['3.5', 'שיפור עדכונים, אנליטיקה וסמלי אפליקציה', '2026-03-12', 2, 100, 'Completed', 'No', 'צוות דסקטופ', '3.4'],
      ['3.6', 'שדרוג תלויות לפיתוח ותחזוקה', '2026-03-16', 2, 100, 'Completed', 'No', 'צוות דסקטופ', '3.5'],
      ['3.7', 'אבן דרך: הפצה רחבה מוכנה לבדיקה', '2026-03-16', 0, 100, 'Completed', 'Yes', 'צוות הפצה', '3.6'],
      ['4', 'תמיכה בסביבות מבודדות וארגוניות', '2026-03-22', 5, 100, 'Completed', 'No', 'צוות הפצה', '3.7'],
      ['4.1', 'הוספת תמיכת airgap להפעלה עצמית עם Docker', '2026-03-22', 3, 100, 'Completed', 'No', 'צוות הפצה', '3.7'],
      ['4.2', 'תיעוד אפשרות הפעלה עצמית לארגונים', '2026-03-22', 1, 100, 'Completed', 'No', 'צוות הפצה', '4.1'],
      ['4.3', 'אבן דרך: מוכנות לסביבה ארגונית מבודדת', '2026-03-22', 0, 100, 'Completed', 'Yes', 'אחראי פלטפורמה', '4.2'],
      ['5', 'שילוב זרימות יצירה מתקדמות', '2026-06-22', 8, 100, 'Completed', 'No', 'צוות Backend ו-AI', '4.3'],
      ['5.1', 'שיפור טיפול בבקשות יצירה ושגיאות', '2026-06-22', 1, 100, 'Completed', 'No', 'צוות Backend ו-AI', '4.3'],
      ['5.2', 'שיפור אינטגרציות בין הממשק לשרת', '2026-06-22', 2, 100, 'Completed', 'No', 'צוות דסקטופ', '5.1'],
      ['5.3', 'שילוב ComfyUI כבסיס לזרימות מורכבות', '2026-06-24', 2, 100, 'Completed', 'No', 'צוות Backend ו-AI', '5.2'],
      ['5.4', 'תיקון תאימות מדיה של LTXVideo', '2026-06-24', 1, 100, 'Completed', 'No', 'צוות Backend ו-AI', '5.3'],
      ['5.5', 'אבן דרך: פלטפורמת יצירה מתקדמת מוכנה', '2026-06-24', 0, 100, 'Completed', 'Yes', 'אחראי פלטפורמה', '5.4'],
      ['6', 'אישור ארגוני והעברה לתפעול', '2026-07-01', 65, 0, 'Pending', 'No', 'אחראי מוצר', '5.5'],
      ['6.1', 'בדיקות עומס על מחשבי עבודה מייצגים', '2026-07-01', 10, 0, 'Pending', 'No', 'צוות Backend ו-AI', '5.5'],
      ['6.2', 'בדיקות התקנה והפצה בארגון', '2026-07-15', 10, 0, 'Pending', 'No', 'צוות הפצה', '6.1'],
      ['6.3', 'בדיקות אבטחה והרשאות לתפעול מקומי', '2026-07-29', 10, 0, 'Pending', 'No', 'צוות הפצה', '6.2'],
      ['6.4', 'הכנת מדריך שימוש לצוותי בטיחות', '2026-08-12', 12, 0, 'Pending', 'No', 'אחראי מוצר', '6.3'],
      ['6.5', 'העברת ידע לתמיכה ותפעול', '2026-08-31', 15, 0, 'Pending', 'No', 'צוות הפצה', '6.4'],
      ['6.6', 'אבן דרך: פלטפורמה מאושרת לשימוש ארגוני', '2026-09-30', 0, 0, 'Pending', 'Yes', 'אחראי מוצר', '6.5'],
    ],
  },
];

function mergeByName(rows) {
  const seen = new Set();
  return rows.filter(([name]) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function prefixTaskId(prefix, taskId) {
  return `${prefix}.${taskId}`;
}

function prefixPred(prefix, pred) {
  return String(pred || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => prefixTaskId(prefix, value))
    .join(', ');
}

function prefixTasks(prefix, tasks) {
  return tasks.map(([taskId, taskName, startDate, duration, progress, status, milestone, resource, pred]) => [
    prefixTaskId(prefix, taskId),
    taskName,
    startDate,
    duration,
    progress,
    status,
    milestone,
    resource,
    prefixPred(prefix, pred),
  ]);
}

const safetyProject = projects[0];
const platformProject = projects[1];
const importProjects = [{
  id: 'ltx-safety-single-gantt',
  title: 'מפת דרכים אחת לסרטוני בטיחות ב-LTX Desktop',
  department: 'בטיחות והדרכה',
  division: 'מודעות, מניעת סיכונים ותשתית וידאו',
  field: 'יצירת סרטוני בטיחות לצמצום מפגעים והגברת מודעות',
  description: 'גאנט יחיד המבוסס על קומיטים מ-2026-03-05 עד 2026-06-24, וממשיך עד ספטמבר לטובת פיילוט, הטמעה ואישור מנהלים.',
  status: 'In Progress',
  due: '2026-09-30',
  roles: mergeByName([...safetyProject.roles, ...platformProject.roles]),
  resources: mergeByName([...safetyProject.resources, ...platformProject.resources]),
  goals: [
    ['אב טיפוס ראשון לסרטון בטיחות מוכן', '2026-03-05', 100, 'completed'],
    ['ניהול נכסי וידאו ותפעול דסקטופ יציבים', '2026-03-11', 100, 'completed'],
    ['תמיכה בהפצה רחבה ואייר-גאפ', '2026-03-22', 100, 'completed'],
    ['שיפור יצירה, גלריה וזרימות מתקדמות מוכנים', '2026-06-24', 100, 'completed'],
    ['אישור מנהלים להטמעת סרטוני בטיחות', '2026-09-30', 0, 'pending'],
  ],
  tasks: [
    ['1', 'מסלול עסקי: יצירת סרטוני בטיחות', '2026-03-05', 151, 45, 'In Progress', 'No', 'אחראי מוצר', ''],
    ...prefixTasks('1', safetyProject.tasks),
    ['2', 'מסלול תשתיתי: פלטפורמת יצירה שולחנית', '2026-03-05', 151, 45, 'In Progress', 'No', 'אחראי פלטפורמה', ''],
    ...prefixTasks('2', platformProject.tasks),
  ],
}];

function styleHeader(ws) {
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, size: 9, color: { argb: 'FF737373' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E5E5' } } };
  });
}

function applyRtl(ws) {
  ws.views = [{ rightToLeft: true }];
}

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Codex';
  wb.created = new Date();
  wb.modified = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const projectsWs = wb.addWorksheet('Projects');
  applyRtl(projectsWs);
  projectsWs.columns = [
    { header: 'Title', key: 'title', width: 38 },
    { header: 'Department', key: 'department', width: 22 },
    { header: 'Division', key: 'division', width: 24 },
    { header: 'Field', key: 'field', width: 48 },
    { header: 'Description', key: 'description', width: 80 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Due Date', key: 'due', width: 15 },
  ];
  styleHeader(projectsWs);

  const projectRowById = new Map();
  importProjects.forEach((project, index) => {
    projectRowById.set(project.id, index + 2);
    projectsWs.addRow({
      title: project.title,
      department: project.department,
      division: project.division,
      field: project.field,
      description: project.description,
      status: project.status,
      due: project.due,
    });
  });
  projectsWs.getColumn(7).numFmt = 'yyyy-mm-dd';

  const projectRef = (project) => ({
    formula: `Projects!$A$${projectRowById.get(project.id)}`,
    result: project.title,
  });

  const goalsWs = wb.addWorksheet('Goals');
  applyRtl(goalsWs);
  goalsWs.columns = [
    { header: 'Project', key: 'project', width: 38 },
    { header: 'Milestone', key: 'milestone', width: 48 },
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Progress (%)', key: 'progress', width: 14 },
    { header: 'Status', key: 'status', width: 15 },
  ];
  styleHeader(goalsWs);
  goalsWs.getColumn(1).hidden = true;
  importProjects.forEach((project) => {
    project.goals.forEach(([milestone, date, progress, status]) => {
      goalsWs.addRow({ project: projectRef(project), milestone, date, progress, status });
    });
  });
  goalsWs.getColumn(3).numFmt = 'yyyy-mm-dd';

  const ganttWs = wb.addWorksheet('Gantt');
  applyRtl(ganttWs);
  ganttWs.columns = [
    { header: 'Task ID', key: 'taskId', width: 10 },
    { header: 'Project', key: 'project', width: 38 },
    { header: 'Task Name', key: 'taskName', width: 56 },
    { header: 'Start Date', key: 'startDate', width: 15 },
    { header: 'Duration (Days)', key: 'duration', width: 16 },
    { header: 'Progress (%)', key: 'progress', width: 14 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Milestone', key: 'milestone', width: 12 },
    { header: 'Resource', key: 'resource', width: 26 },
    { header: 'PRED', key: 'pred', width: 18 },
  ];
  styleHeader(ganttWs);
  ganttWs.getColumn(2).hidden = true;
  importProjects.forEach((project) => {
    project.tasks.forEach(([taskId, taskName, startDate, duration, progress, status, milestone, resource, pred]) => {
      ganttWs.addRow({
        taskId,
        project: projectRef(project),
        taskName,
        startDate,
        duration,
        progress,
        status,
        milestone,
        resource,
        pred,
      });
    });
  });
  ganttWs.getColumn(4).numFmt = 'yyyy-mm-dd';

  const resourcesWs = wb.addWorksheet('Resources');
  applyRtl(resourcesWs);
  resourcesWs.columns = [
    { header: 'Project', key: 'project', width: 38 },
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Role', key: 'role', width: 28 },
    { header: 'Color', key: 'color', width: 12 },
    { header: 'Capacity (%)', key: 'capacity', width: 14 },
  ];
  styleHeader(resourcesWs);
  resourcesWs.getColumn(1).hidden = true;
  importProjects.forEach((project) => {
    project.resources.forEach(([name, role, color, capacity]) => {
      resourcesWs.addRow({ project: projectRef(project), name, role, color, capacity });
    });
  });

  const rolesWs = wb.addWorksheet('Roles');
  applyRtl(rolesWs);
  rolesWs.columns = [
    { header: 'Project', key: 'project', width: 38 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Budget', key: 'budget', width: 15 },
    { header: 'Paid By', key: 'paidBy', width: 15 },
    { header: 'Currency', key: 'currency', width: 12 },
  ];
  styleHeader(rolesWs);
  rolesWs.getColumn(1).hidden = true;
  importProjects.forEach((project) => {
    project.roles.forEach(([name, budget, paidBy, currency]) => {
      rolesWs.addRow({ project: projectRef(project), name, budget, paidBy, currency });
    });
  });

  await wb.xlsx.writeFile(outputPath);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
