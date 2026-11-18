/** Water quality grades, best first. Must match STP_GRADES in app.py. */
export const GRADES = ["Platinum", "Gold", "Silver", "General"] as const;
export type Grade = (typeof GRADES)[number];

export const isGrade = (g?: string | null): g is Grade => GRADES.includes(g as Grade);
