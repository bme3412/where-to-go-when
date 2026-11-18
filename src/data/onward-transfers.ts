// Representative onward legs. Durations exclude waiting for the next departure.
export interface OnwardTransfer {
  gateway: string;
  leg: string;
  minutes: number;
  source: string;
}

export const ONWARD_TRANSFERS: Readonly<Partial<Record<string, OnwardTransfer>>> = {
  Maafushi: { gateway: 'MLE', leg: 'Malé airport to Maafushi by speedboat', minutes: 30, source: 'https://crystalsandsmaafushi.com/location' },
  Dhigurah: { gateway: 'MLE', leg: 'Malé airport to Dhigurah by speedboat', minutes: 120, source: 'https://www.seasidedhigurah.com/visit-dhigurah' },
  'Puerto Villamil': { gateway: 'GPS', leg: 'Santa Cruz to Isabela by boat', minutes: 150, source: 'https://www.galapagosislands.com/travel/faq/' },
};
