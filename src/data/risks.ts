import type { RiskRow } from '../types';

export const RISKS = [
 [new Set(['Miami','Cancún','Havana','San Juan','New Orleans','Cape Cod','New York']),8.3,1.0,0.22,'Hurricane season'],
 [new Set(['Aruba','Cartagena']),8.6,1.0,0.05,'Hurricane season (edge)'],
 [new Set(['Hong Kong','Tokyo','Kyoto','Hoi An','Hanoi','Seoul']),8.2,1.1,0.15,'Typhoon season'],
 [new Set(['Fiji','Mauritius','Cairns','Tahiti']),1.8,1.1,0.15,'Cyclone season'],
 [new Set(['Phuket','Goa','Colombo','Bangkok','Siem Reap']),7.5,1.6,0.05,'Monsoon season']
] as const satisfies readonly RiskRow[];
