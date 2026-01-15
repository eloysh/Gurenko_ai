import axios from 'axios';

const API_BASE = 'https://api.freepik.com/v1';

export async function createMysticTask({ apiKey, prompt, aspect_ratio = 'social_story_9_16' }) {
  const url = `${API_BASE}/ai/mystic`;
  const res = await axios.post(
    url,
    {
      prompt,
      aspect_ratio,
      resolution: '2k',
      model: 'realism',
      filter_nsfw: true
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-freepik-api-key': apiKey,
      },
      timeout: 60_000,
    }
  );
  return res.data?.data;
}

export async function getMysticTask({ apiKey, taskId }) {
  const url = `${API_BASE}/ai/mystic/${taskId}`;
  const res = await axios.get(url, {
    headers: {
      'x-freepik-api-key': apiKey,
    },
    timeout: 60_000,
  });
  return res.data?.data;
}
