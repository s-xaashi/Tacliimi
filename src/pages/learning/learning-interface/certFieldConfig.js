export const CANVAS_W = 2800;
export const CANVAS_H = 1980;

export const GOLD = '#C9A84C';
export const NAVY = '#0B2D57';

export const ORIG = {
    // Student photo and name group centered below "THIS CERTIFIES THAT"
    photoX: 1002, photoY: 522, photoR: 68,
    nameY: 522,

    // Course title centered below "HAS SUCCESSFULLY COMPLETED THE COURSE"
    courseX: 1400, courseY: 689,

    // Stats row — date aligned under "DATE COMPLETED" background label, score under "FINAL SCORE"
    dateCX: 1060, dateCY: 1240,
    scoreX: 1630, scoreY: 1240,

    // Tacliimi logo stamp (circular badge right of FINAL SCORE label)
    stampCX: 1860, stampCY: 1185, stampR: 84,

    // Instructor signature (LEFT block) — cursive name + printed label
    instrSigX: 1085, instrSigY: 1365,
    instrNmX: 1085, instrNmY: 1435,

    // Tacliimi signature (RIGHT block) — cursive signature over pre-drawn line
    tacliimiSigX: 1770, tacliimiSigY: 1365,


    // Verification corner labels (inside parameter line)
    verX: 180, verY: 1855,
    issuedX: 2620, issuedY: 1855,
};

// ─── Font sizes ────────────────────────────────────────────────────────ــــ───
export const FS = {
    name: 120,   // italic student name
    course: 78,    // course name
    date: 54,    // date / score
    sig: 88,    // caveat instructor signature
    tacliimiSig: 100,  // caveat Tacliimi signature (slightly larger)
    instrNm: 36,    // instructor name label
    ver: 34,    // verification code mono
    issued: 32,    // date issued
};

// Gap between photo right-edge and name left-edge
export const PHOTO_NAME_GAP = 44;

export const SCALE = 0.5;
