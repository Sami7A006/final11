import { Ingredient } from '../types/ingredient';
import * as cheerio from 'cheerio';

// Expanded ingredient database with more detailed information
const ingredientDatabase: Record<string, {
  baseScore: number;
  category: string;
  concerns: string[];
  benefits: string[];
  scientificName?: string;
  restrictions?: string[];
  naturalAlternatives?: string[];
  researchLinks?: string[];
}> = {
  // Preservatives
  'paraben': {
    baseScore: 8,
    category: 'Preservative',
    concerns: [
      'Endocrine disruption',
      'Reproductive toxicity',
      'Potential carcinogenic effects',
      'Skin sensitization'
    ],
    benefits: ['Effective preservation', 'Extends product shelf life'],
    restrictions: ['Restricted in EU', 'Limited use in Japan'],
    naturalAlternatives: ['Grapefruit seed extract', 'Rosemary extract', 'Neem oil'],
    researchLinks: [
      'https://pubmed.ncbi.nlm.nih.gov/parabens-safety',
      'https://www.sciencedirect.com/topics/parabens-toxicology'
    ]
  },
  'phenoxyethanol': {
    baseScore: 4,
    category: 'Preservative',
    concerns: ['Potential skin irritation', 'Allergic reactions in sensitive individuals'],
    benefits: ['Broad spectrum preservation', 'Stable in formulations'],
    naturalAlternatives: ['Leuconostoc ferment filtrate', 'Lactobacillus ferment']
  },
  'sodium benzoate': {
    baseScore: 3,
    category: 'Preservative',
    concerns: ['Potential irritation at high concentrations'],
    benefits: ['Natural origin option', 'Effective against mold'],
    scientificName: 'Sodium benzoate'
  },

  // Surfactants
  'sodium lauryl sulfate': {
    baseScore: 6,
    category: 'Surfactant',
    concerns: [
      'Skin irritation',
      'Barrier disruption',
      'Environmental concerns',
      'Potential contamination with 1,4-dioxane'
    ],
    benefits: ['Effective cleansing', 'Good foaming'],
    naturalAlternatives: ['Decyl glucoside', 'Coco glucoside']
  },
  'cocamidopropyl betaine': {
    baseScore: 3,
    category: 'Surfactant',
    concerns: ['Mild skin sensitization'],
    benefits: ['Gentle cleansing', 'Reduces irritation from other surfactants']
  },

  // Emollients
  'glycerin': {
    baseScore: 1,
    category: 'Emollient',
    concerns: [],
    benefits: [
      'Hydration',
      'Skin barrier support',
      'Natural moisture factor',
      'Improves product texture'
    ],
    scientificName: 'Glycerol'
  },
  'hyaluronic acid': {
    baseScore: 1,
    category: 'Humectant',
    concerns: [],
    benefits: [
      'Deep hydration',
      'Anti-aging properties',
      'Supports skin barrier',
      'Improves wound healing'
    ],
    scientificName: 'Sodium Hyaluronate'
  },

  // Antioxidants
  'vitamin e': {
    baseScore: 1,
    category: 'Antioxidant',
    concerns: [],
    benefits: [
      'Antioxidant protection',
      'Skin conditioning',
      'Anti-inflammatory',
      'Helps preserve other ingredients'
    ],
    scientificName: 'Tocopherol'
  },
  'vitamin c': {
    baseScore: 1,
    category: 'Antioxidant',
    concerns: ['Stability issues'],
    benefits: [
      'Brightening',
      'Collagen support',
      'Photoprotection',
      'Anti-aging'
    ],
    scientificName: 'Ascorbic Acid'
  },

  // UV Filters
  'titanium dioxide': {
    baseScore: 3,
    category: 'UV Filter',
    concerns: [
      'Potential inhalation risk (powder form)',
      'Nanoparticle concerns'
    ],
    benefits: [
      'Broad spectrum protection',
      'Stable sun protection',
      'Non-irritating'
    ],
    scientificName: 'TiO2'
  },
  'zinc oxide': {
    baseScore: 2,
    category: 'UV Filter',
    concerns: ['White cast on skin'],
    benefits: [
      'Natural sun protection',
      'Skin soothing',
      'Anti-inflammatory'
    ],
    scientificName: 'ZnO'
  }
};

const fetchEWGData = async (ingredient: string): Promise<Partial<Ingredient> | null> => {
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ewg-search`;
    const response = await fetch(`${apiUrl}?ingredient=${encodeURIComponent(ingredient)}`, {
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      }
    });

    if (!response.ok) {
      console.warn(`Failed to fetch EWG data for ${ingredient}: ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    
    // Handle both scraped data and HTML fallback
    if (data.data) {
      // Process structured data from Puppeteer scraping
      const productData = data.data[0]; // Use first result
      if (productData) {
        return {
          ewgScore: parseScore(productData.score),
          safetyLevel: getSafetyLevel(parseScore(productData.score)),
          reasonForConcern: productData.concerns?.join(', '),
          function: productData.category,
          commonUse: getCommonUse(ingredient),
        };
      }
    } else if (data.html) {
      // Process HTML fallback
      const $ = cheerio.load(data.html);
      const firstResult = $('.product-listing').first();
      
      if (!firstResult.length) return null;

      const scoreText = firstResult.find('.product-score').text().trim();
      let score = parseScore(scoreText);

      const concerns = firstResult.find('.product-concerns li')
        .map((_, el) => $(el).text().trim())
        .get()
        .join(', ');

      const functionText = firstResult.find('.product-details .function').text().trim();
      const useText = firstResult.find('.product-details .common-use').text().trim();

      // Combine with database data
      const dbMatch = findIngredientInDatabase(ingredient);
      const finalScore = score || (dbMatch ? dbMatch.baseScore : calculateDefaultScore(ingredient));

      return {
        ewgScore: finalScore,
        safetyLevel: getSafetyLevel(finalScore),
        reasonForConcern: concerns || (dbMatch ? dbMatch.concerns.join(', ') : getDefaultConcern(finalScore)),
        function: functionText || (dbMatch ? dbMatch.category : getIngredientFunction(ingredient)),
        commonUse: useText || getCommonUse(ingredient),
        scientificName: dbMatch?.scientificName,
        benefits: dbMatch?.benefits?.join(', '),
        restrictions: dbMatch?.restrictions?.join(', '),
        naturalAlternatives: dbMatch?.naturalAlternatives?.join(', '),
        researchLinks: dbMatch?.researchLinks?.join('\n')
      };
    }

    return null;
  } catch (error) {
    console.warn(`Error fetching EWG data for ${ingredient}:`, error);
    return null;
  }
};

const parseScore = (scoreText: string | undefined): number | null => {
  if (!scoreText) return null;

  // Try to extract numeric score
  const numericMatch = scoreText.match(/\d+/);
  if (numericMatch) {
    const score = parseInt(numericMatch[0]);
    // Validate score range
    return Math.max(1, Math.min(10, score));
  }

  // Check for text-based ratings
  const riskLevels = {
    low: /\b(low|safe|minimal|good)\b/i,
    moderate: /\b(moderate|medium|average)\b/i,
    high: /\b(high|unsafe|dangerous|poor)\b/i
  };

  if (riskLevels.low.test(scoreText)) return 2;
  if (riskLevels.moderate.test(scoreText)) return 5;
  if (riskLevels.high.test(scoreText)) return 8;

  return null;
};

const findIngredientInDatabase = (ingredient: string): typeof ingredientDatabase[keyof typeof ingredientDatabase] | null => {
  const normalizedInput = ingredient.toLowerCase();
  
  // Direct match
  if (normalizedInput in ingredientDatabase) {
    return ingredientDatabase[normalizedInput];
  }

  // Partial match with improved accuracy
  let bestMatch = null;
  let highestMatchScore = 0;

  for (const [key, value] of Object.entries(ingredientDatabase)) {
    // Calculate similarity score
    const similarity = calculateStringSimilarity(normalizedInput, key);
    if (similarity > highestMatchScore && similarity > 0.8) { // 80% similarity threshold
      highestMatchScore = similarity;
      bestMatch = value;
    }
  }

  return bestMatch;
};

const calculateStringSimilarity = (str1: string, str2: string): number => {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const longerLength = longer.length;
  return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength.toString());
};

const editDistance = (str1: string, str2: string): number => {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + substitutionCost
      );
    }
  }

  return matrix[str2.length][str1.length];
};

const calculateDefaultScore = (ingredient: string): number => {
  const riskPatterns = {
    high: {
      score: 8,
      patterns: [
        /paraben/i, /phthalate/i, /formaldehyde/i, /triclosan/i,
        /bha/i, /bht/i, /toluene/i, /petroleum/i, /lead/i, /mercury/i,
        /hydroquinone/i, /oxybenzone/i, /coal tar/i, /ethanolamines/i,
        /dioxane/i, /nitrosamine/i, /polyethylene/i
      ]
    },
    moderate: {
      score: 5,
      patterns: [
        /peg-\d+/i, /phenoxyethanol/i, /sodium lauryl sulfate/i,
        /propylene/i, /butylene/i, /synthetic/i, /fragrance/i,
        /dmdm/i, /diazolidinyl/i, /quaternium/i, /methylisothiazolinone/i
      ]
    },
    low: {
      score: 2,
      patterns: [
        /water/i, /aqua/i, /aloe/i, /glycerin/i, /vitamin/i,
        /panthenol/i, /allantoin/i, /zinc/i, /titanium dioxide/i,
        /hyaluronic/i, /ceramide/i, /peptide/i, /amino acid/i
      ]
    },
    veryLow: {
      score: 1,
      patterns: [
        /^water$/i, /^aloe vera$/i, /^glycerin$/i,
        /^vitamin (a|b|c|d|e)$/i, /^zinc oxide$/i,
        /^green tea$/i, /^chamomile$/i, /^calendula$/i,
        /^jojoba oil$/i, /^shea butter$/i
      ]
    }
  };

  for (const [risk, { patterns, score }] of Object.entries(riskPatterns)) {
    if (patterns.some(pattern => pattern.test(ingredient))) {
      return score;
    }
  }

  return 5; // Default moderate score
};

const getSafetyLevel = (score: number): string => {
  if (score <= 2) return 'Low Concern';
  if (score <= 6) return 'Moderate Concern';
  return 'High Concern';
};

const getDefaultConcern = (score: number): string => {
  if (score <= 2) return 'Generally recognized as safe with extensive safety data';
  if (score <= 6) return 'Moderate safety concerns, may require more research';
  return 'High safety concerns, potential risks identified';
};

const getIngredientFunction = (ingredient: string): string => {
  const functions: { [key: string]: string[] } = {
    'Preservative': [
      'paraben', 'phenoxyethanol', 'benzoate', 'sorbate', 'formaldehyde',
      'methylisothiazolinone', 'benzyl alcohol', 'potassium sorbate',
      'sodium benzoate', 'ethylhexylglycerin'
    ],
    'Surfactant': [
      'lauryl', 'laureth', 'sodium', 'cocamide', 'sulfate', 'betaine',
      'decyl glucoside', 'coco-glucoside', 'polysorbate', 'taurate',
      'isethionate', 'amphoacetate'
    ],
    'Emollient': [
      'oil', 'butter', 'glycerin', 'lanolin', 'dimethicone', 'squalane',
      'ceramide', 'fatty acid', 'triglyceride', 'caprylic', 'stearic',
      'cetyl', 'cetearyl', 'isopropyl myristate'
    ],
    'Fragrance': [
      'fragrance', 'parfum', 'aroma', 'essential oil', 'limonene',
      'linalool', 'citral', 'geraniol', 'citronellol', 'eugenol'
    ],
    'UV Filter': [
      'benzophenone', 'avobenzone', 'titanium dioxide', 'zinc oxide',
      'octinoxate', 'oxybenzone', 'octocrylene', 'homosalate',
      'ethylhexyl methoxycinnamate', 'tinosorb'
    ],
    'Antioxidant': [
      'tocopherol', 'vitamin', 'retinol', 'ascorbic', 'niacinamide',
      'flavonoid', 'polyphenol', 'resveratrol', 'ferulic', 'ubiquinone'
    ],
    'Humectant': [
      'glycerin', 'hyaluronic', 'urea', 'propylene glycol', 'butylene glycol',
      'sodium pca', 'sorbitol', 'panthenol', 'sodium lactate', 'aloe'
    ],
    'Emulsifier': [
      'cetyl', 'stearic', 'glyceryl', 'polysorbate', 'cetearyl',
      'peg', 'sorbitan', 'carbomer', 'hydroxypropyl', 'lecithin'
    ],
    'pH Adjuster': [
      'citric acid', 'lactic acid', 'sodium hydroxide', 'potassium hydroxide',
      'triethanolamine', 'aminomethyl propanol'
    ],
    'Chelating Agent': [
      'edta', 'tetrasodium', 'disodium', 'trisodium', 'etidronic acid'
    ]
  };

  const lowerIngredient = ingredient.toLowerCase();
  for (const [func, keywords] of Object.entries(functions)) {
    if (keywords.some(keyword => lowerIngredient.includes(keyword))) {
      return func;
    }
  }

  return 'Other/Unknown';
};

const getCommonUse = (ingredient: string): string => {
  const uses: { [key: string]: string[] } = {
    'Moisturizing agent': [
      'glycerin', 'oil', 'butter', 'hyaluronic', 'dimethicone',
      'squalane', 'ceramide', 'fatty acid', 'jojoba', 'aloe',
      'sodium pca', 'urea', 'panthenol'
    ],
    'Cleansing agent': [
      'lauryl', 'laureth', 'cocamide', 'sulfate', 'glucoside',
      'betaine', 'sodium cocoyl', 'decyl', 'isethionate', 'taurate'
    ],
    'Preservative system': [
      'paraben', 'phenoxyethanol', 'benzoate', 'formaldehyde',
      'methylisothiazolinone', 'potassium sorbate', 'benzyl alcohol',
      'sodium benzoate', 'ethylhexylglycerin'
    ],
    'Fragrance component': [
      'fragrance', 'parfum', 'aroma', 'essential oil', 'limonene',
      'linalool', 'citral', 'geraniol', 'citronellol', 'eugenol'
    ],
    'Sun protection': [
      'benzophenone', 'avobenzone', 'titanium', 'zinc oxide',
      'octinoxate', 'oxybenzone', 'octocrylene', 'homosalate',
      'tinosorb', 'uvinul'
    ],
    'Antioxidant protection': [
      'tocopherol', 'vitamin', 'retinol', 'ascorbic', 'niacinamide',
      'flavonoid', 'polyphenol', 'resveratrol', 'ferulic', 'ubiquinone'
    ],
    'Thickening agent': [
      'carbomer', 'xanthan', 'cellulose', 'guar', 'carrageenan',
      'acacia', 'agar', 'alginate', 'hydroxypropyl', 'hydroxyethylcellulose'
    ],
    'Skin conditioning': [
      'aloe', 'panthenol', 'allantoin', 'chamomile', 'calendula',
      'green tea', 'collagen', 'peptide', 'ceramide', 'beta glucan'
    ],
    'pH balancing': [
      'citric acid', 'lactic acid', 'sodium hydroxide', 'potassium hydroxide',
      'triethanolamine', 'aminomethyl propanol'
    ],
    'Stabilizing agent': [
      'edta', 'tetrasodium', 'disodium', 'trisodium', 'etidronic acid',
      'sodium phytate', 'sodium gluconate'
    ]
  };

  const lowerIngredient = ingredient.toLowerCase();
  for (const [use, keywords] of Object.entries(uses)) {
    if (keywords.some(keyword => lowerIngredient.includes(keyword))) {
      return use;
    }
  }

  return 'Various applications';
};

export const analyzeIngredients = async (ingredientList: string): Promise<Ingredient[]> => {
  const ingredientsArray = ingredientList
    .toLowerCase()
    .split(/[,;\n]+/)
    .map(item => item.trim())
    .filter(item => item && item.length > 1);

  const analyzedIngredients: Ingredient[] = [];

  for (const name of ingredientsArray) {
    const ewgData = await fetchEWGData(name);
    const dbMatch = findIngredientInDatabase(name);
    
    analyzedIngredients.push({
      name: name.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
      function: ewgData?.function || (dbMatch ? dbMatch.category : getIngredientFunction(name)),
      ewgScore: ewgData?.ewgScore || (dbMatch ? dbMatch.baseScore : calculateDefaultScore(name)),
      safetyLevel: ewgData?.safetyLevel || (dbMatch ? getSafetyLevel(dbMatch.baseScore) : getSafetyLevel(calculateDefaultScore(name))),
      reasonForConcern: ewgData?.reasonForConcern || (dbMatch ? dbMatch.concerns.join(', ') : getDefaultConcern(calculateDefaultScore(name))),
      commonUse: ewgData?.commonUse || getCommonUse(name),
      scientificName: dbMatch?.scientificName,
      benefits: dbMatch?.benefits?.join(', '),
      restrictions: dbMatch?.restrictions?.join(', '),
      naturalAlternatives: dbMatch?.naturalAlternatives?.join(', '),
      researchLinks: dbMatch?.researchLinks?.join('\n')
    });
  }

  return analyzedIngredients;
};