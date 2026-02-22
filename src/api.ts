import * as https from 'https';

const BASE_URL = 'https://clawsouls.ai/api/v1';

function fetch(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

export interface Soul {
  name: string;
  owner: string;
  fullName: string;
  displayName: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  downloads: number;
  avgRating: number | null;
  scanScore: number | null;
  scanStatus: string | null;
}

export async function getSouls(): Promise<Soul[]> {
  const data = await fetch(`${BASE_URL}/souls`);
  const json = JSON.parse(data);
  return json.souls || [];
}

export async function getBundle(owner: string, name: string): Promise<any> {
  const data = await fetch(`${BASE_URL}/bundle/${owner}/${name}`);
  return JSON.parse(data);
}
