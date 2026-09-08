export const CANVAS_W = 2800;
export const CANVAS_H = 1980;

export const GOLD = '#C9A84C';
export const NAVY = '#0B2D57';

export const ORIG = {
    // Student photo and name group centered below "THIS CERTIFIES THAT"
    photoX: 1002, photoY: 522,  photoR: 68,
    nameY:  522,
    
    // Course title centered below "HAS SUCCESSFULLY COMPLETED THE COURSE"
    courseX: 1400, courseY: 679,
    
    // Stats row centered below static labels "DATE COMPLETED" and "FINAL SCORE"
    dateCX: 1080, dateCY: 1240,
    scoreX: 1680, scoreY: 1240,
    
    // Signature placing over the signature line
    instrSigX: 1080,  instrSigY: 1365,
    instrNmX:  1080,  instrNmY:  1435,
    
    // Verification corner labels (inside parameter line)
    verX: 180,   verY:  1855,
    issuedX: 2620, issuedY: 1855,
};

// ─── Font sizes ────────────────────────────────────────────────────────ــــ───
export const FS = {
    name:    120,   // italic student name
    course:  78,    // course name
    date:    54,    // date / score
    sig:     88,    // caveat signature
    instrNm: 36,    // instructor name label
    ver:     34,    // verification code mono
    issued:  32,    // date issued
};

// Gap between photo right-edge and name left-edge
export const PHOTO_NAME_GAP = 44;

export const SCALE = 0.5;
