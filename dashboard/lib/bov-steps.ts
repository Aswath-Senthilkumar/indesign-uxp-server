export type BovStepType = "dynamic" | "static";

export interface BovStepMeta {
    step: number;
    label: string;
    /** Abbreviated label for the stepper bar */
    shortLabel: string;
    type: BovStepType;
}

export const BOV_STEPS: BovStepMeta[] = [
    { step: 1, label: "Cover",                shortLabel: "Cover",   type: "dynamic" },
    { step: 2, label: "Section 1",            shortLabel: "S1",      type: "dynamic" },
    { step: 3, label: "Section 2",            shortLabel: "S2",      type: "dynamic" },
    { step: 4, label: "Section 3",            shortLabel: "S3",      type: "dynamic" },
    { step: 5, label: "Sections 4, 5 & LOR",  shortLabel: "S4–LOR",  type: "static"  },
    { step: 6, label: "Brag Sheets",           shortLabel: "Brag",    type: "dynamic" },
    { step: 7, label: "Maps & Contacts",       shortLabel: "Maps",    type: "static"  },
];

export const BOV_STEP_COUNT = BOV_STEPS.length; // 7, complete is step 8
export const BOV_COMPLETE_STEP = 8;

export function getBovStep(n: number): BovStepMeta | undefined {
    return BOV_STEPS.find((s) => s.step === n);
}

export function isValidBovStep(n: number): boolean {
    return n >= 1 && n <= BOV_STEP_COUNT;
}
