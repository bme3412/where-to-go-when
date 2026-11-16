import type { TripEvent } from '../types';
const DAY = 86_400_000;

// Calendar days use UTC so DST cannot change trip lengths or event boundaries.
export function easter(y: number): Date{const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;return new Date(Date.UTC(y,mo-1,da))}
export const CNY: Readonly<Record<number, readonly [number, number] | undefined>>={2025:[0,29],2026:[1,17],2027:[1,6],2028:[0,26],2029:[1,13]};
export const DIWALI: Readonly<Record<number, readonly [number, number] | undefined>>={2025:[9,20],2026:[10,8],2027:[9,29],2028:[9,17],2029:[10,5]};
export const HOLI: Readonly<Record<number, readonly [number, number] | undefined>>={2025:[2,14],2026:[2,4],2027:[2,22],2028:[2,11],2029:[2,1]};
export const RAMADAN: Readonly<Record<number, readonly [readonly [number, number], readonly [number, number]] | undefined>>={2025:[[2,1],[2,30]],2026:[[1,18],[2,19]],2027:[[1,8],[2,9]],2028:[[0,28],[1,26]],2029:[[0,16],[1,14]]};
const D=(y: number,m: number,d: number)=>new Date(Date.UTC(y,m,d));
const add=(dt: Date,n: number)=>new Date(dt.getTime()+n*DAY);
export function thanksgiving(y: number): Date{const d=D(y,10,1);const off=(4-d.getUTCDay()+7)%7;return add(d,off+21)}
export function eventsForYear(y: number): TripEvent[]{
 const E: TripEvent[]=[];const ev=(cities: string[],a: Date,b: Date,crowd: number,name: string,festival: boolean)=>E.push({cities:new Set(cities),start:a.getTime(),end:b.getTime()+DAY-1,crowd,name,festival});
 const ea=easter(y);
 ev(['Seville'],add(ea,-7),ea,0.45,'Holy Week (Semana Santa)',true);
 ev(['Rome'],add(ea,-4),add(ea,1),0.35,'Easter in Rome',true);
 ev(['Paris','London','Barcelona','Lisbon','Amsterdam','Prague','Athens','Dubrovnik','Tenerife'],add(ea,-5),add(ea,7),0.15,'European Easter break',false);
 ev(['Rio de Janeiro'],add(ea,-50),add(ea,-46),0.5,'Carnival',true);
 ev(['New Orleans'],add(ea,-52),add(ea,-47),0.45,'Mardi Gras',true);
 if(CNY[y]){const c=D(y,...CNY[y]);ev(['Hong Kong','Bangkok','Phuket','Bali','Singapore','Tokyo','Kyoto','Seoul','Chiang Mai','Siem Reap','Hoi An'],add(c,-2),add(c,7),0.35,'Chinese New Year travel',false);ev(['Hanoi'],add(c,-2),add(c,5),0.3,'Tết (Lunar New Year)',true)}
 ev(['Tokyo','Kyoto'],D(y,3,29),D(y,4,5),0.4,'Golden Week (Japan)',false);
 ev(['Honolulu','Seoul','Bali'],D(y,3,29),D(y,4,5),0.15,'Golden Week (Japan)',false);
 ev(['Beijing'],D(y,9,1),D(y,9,7),0.5,'Golden Week (China)',false);
 ev(['Hong Kong','Tokyo','Kyoto','Bangkok','Seoul','Bali','Singapore'],D(y,9,1),D(y,9,7),0.2,'Golden Week (China)',false);
 ev(['Tokyo'],D(y,2,24),D(y,3,8),0.3,'Cherry blossom season',true);
 ev(['Kyoto'],D(y,2,28),D(y,3,12),0.35,'Cherry blossom season',true);
 ev(['Cancún','Miami','San Juan','Aruba','Havana','Honolulu','Las Vegas','San Diego'],D(y,2,7),D(y,3,5),0.3,'US spring break',false);
 const tg=thanksgiving(y);ev(['New York','Cancún','Miami','Honolulu','Las Vegas','San Juan','Aruba'],add(tg,-3),add(tg,3),0.25,'Thanksgiving week',false);
 ev(['Prague','Copenhagen','Interlaken','Paris'],D(y,10,26),D(y,11,23),0.2,'Christmas markets',true);
 ev(['Sydney','New York','Rio de Janeiro','Dubai','Reykjavik','London','Paris'],D(y,11,29),D(y+1,0,1),0.35,"New Year's Eve",true);
 if(DIWALI[y]){const d=D(y,...DIWALI[y]);ev(['Delhi','Goa'],add(d,-2),add(d,2),0.25,'Diwali',true)}
 if(HOLI[y]){const d=D(y,...HOLI[y]);ev(['Delhi'],add(d,-1),add(d,1),0.2,'Holi',true)}
 ev(['Bangkok','Chiang Mai','Phuket'],D(y,3,12),D(y,3,16),0.3,'Songkran water festival',true);
 ev(['Mexico City'],D(y,9,30),D(y,10,2),0.3,'Día de Muertos',true);
 ev(['Patagonia','Cusco','Rio de Janeiro','Buenos Aires','Cape Town','Sydney','Queenstown'],D(y,11,20),D(y+1,0,10),0.2,'Southern summer holidays',false);
 if(RAMADAN[y]){const r=RAMADAN[y];ev(['Cairo','Marrakech','Dubai','Petra','Istanbul'],D(y,...r[0]),D(y,...r[1]),-0.1,'Ramadan (some sites keep shorter hours)',false)}
 return E;
}
