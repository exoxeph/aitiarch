export type TourOutcome = 'skipped' | 'completed';
export type TourStatus = 'unseen' | TourOutcome;

export function isTourOutcome(value: unknown): value is TourOutcome {
 return value === 'skipped' || value === 'completed';
}
