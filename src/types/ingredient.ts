export interface Ingredient {
  name: string;
  function: string;
  ewgScore: number;
  safetyLevel: string;
  reasonForConcern: string;
  commonUse: string;
  scientificName?: string;
  benefits?: string;
  restrictions?: string;
  naturalAlternatives?: string;
  researchLinks?: string;
}