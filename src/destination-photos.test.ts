import { expect, it } from 'vitest';
import photos from './data/destination-photos.json';
import { CITIES } from './data/cities';

it('provides a credited local photo for every catalog destination', () => {
  expect(Object.keys(photos).sort()).toEqual(CITIES.map(city => city.name).sort());
  for (const photo of Object.values(photos)) {
    expect(photo.image).toMatch(/^data:image\/webp;base64,/);
    expect(photo.url).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
    expect(photo.license).toBeTruthy();
    if (photo.license.startsWith('CC BY')) expect(photo.author.trim()).not.toBe('');
  }
});
