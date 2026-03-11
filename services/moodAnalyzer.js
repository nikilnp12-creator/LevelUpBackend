// services/moodAnalyzer.js
// AI-powered mood/emotion analysis for posts using Groq (same provider as mission suggester)

const { MOOD_TYPES, MOOD_EMOJIS } = require('../models/Post');

let groqClient = null;
function getGroq() {
  if (!groqClient && process.env.GROQ_API_KEY) {
    const Groq = require('groq-sdk');
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

/**
 * Analyze the mood/emotion of a post caption using AI.
 * Falls back to keyword-based analysis if Groq is unavailable.
 *
 * @param {string} caption - The post caption text
 * @param {string} [missionTitle] - Optional mission title for context
 * @returns {Promise<{mood: string, moodEmoji: string, confidence: number}>}
 */
async function analyzeMood(caption, missionTitle = '') {
  if (!caption || caption.trim().length < 3) {
    return { mood: 'focused', moodEmoji: MOOD_EMOJIS['focused'], confidence: 0.3 };
  }

  // Try AI analysis first
  let groq;
  try { groq = getGroq(); } catch (_) { /* fallback below */ }

  if (groq) {
    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'user',
          content: `Analyze the mood/emotion of this social media post from a goal-tracking app.
The user is posting about their mission progress.

Post caption: "${caption}"
${missionTitle ? `Mission: "${missionTitle}"` : ''}

Choose EXACTLY ONE mood from this list:
${MOOD_TYPES.join(', ')}

Respond with ONLY a JSON object (no markdown, no explanation):
{"mood": "<mood>", "confidence": <0.0-1.0>}

Mood definitions:
- motivated: energized, driven, ready to push harder
- proud: accomplished, celebrating achievement
- grateful: thankful, appreciative
- excited: thrilled, enthusiastic about progress
- focused: determined, concentrated, in the zone
- struggling: finding it hard, but pushing through
- reflective: thinking deeply, introspective about journey
- peaceful: calm, content, at ease with progress`
        }],
        temperature: 0.1,
        max_tokens: 60,
      });

      const raw = completion.choices[0]?.message?.content?.trim() || '';
      // Extract JSON from response (handle potential markdown wrapping)
      const jsonMatch = raw.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const mood = MOOD_TYPES.includes(parsed.mood) ? parsed.mood : null;
        if (mood) {
          return {
            mood,
            moodEmoji: MOOD_EMOJIS[mood],
            confidence: Math.min(1, Math.max(0, parseFloat(parsed.confidence) || 0.7)),
          };
        }
      }
    } catch (aiErr) {
      console.error('Mood AI analysis error:', aiErr.message);
    }
  }

  // ── Keyword-based fallback ────────────────────────────────────────────────
  return keywordFallback(caption);
}

/**
 * Simple keyword matching when AI is unavailable.
 */
function keywordFallback(text) {
  const lower = text.toLowerCase();
  const rules = [
    { mood: 'excited',    words: ['🎉', '!!!', 'amazing', 'incredible', 'thrilled', 'can\'t believe', 'insane', 'wow', 'lets go', 'let\'s go'] },
    { mood: 'proud',      words: ['💪', 'did it', 'crushed', 'nailed', 'achieved', 'accomplished', 'milestone', 'complete', 'finished', 'smashed'] },
    { mood: 'motivated',  words: ['🔥', 'fired up', 'unstoppable', 'grind', 'no excuses', 'keep going', 'let\'s get it', 'beast mode', 'push'] },
    { mood: 'grateful',   words: ['🙏', 'thankful', 'grateful', 'blessed', 'appreciate', 'thank'] },
    { mood: 'struggling', words: ['😤', 'hard', 'tough', 'difficult', 'struggled', 'barely', 'almost gave up', 'exhausted', 'tired'] },
    { mood: 'reflective', words: ['🤔', 'realized', 'thinking', 'learned', 'lesson', 'looking back', 'reflect', 'journey'] },
    { mood: 'peaceful',   words: ['🧘', 'calm', 'peaceful', 'relaxed', 'content', 'chill', 'serene', 'easy'] },
    { mood: 'focused',    words: ['🎯', 'focused', 'locked in', 'deep work', 'zone', 'concentration', 'discipline', 'consistent'] },
  ];

  let bestMood = 'focused';
  let bestScore = 0;
  for (const rule of rules) {
    const score = rule.words.filter(w => lower.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMood = rule.mood;
    }
  }

  return {
    mood: bestMood,
    moodEmoji: MOOD_EMOJIS[bestMood],
    confidence: bestScore > 0 ? Math.min(0.7, 0.3 + bestScore * 0.15) : 0.3,
  };
}

module.exports = { analyzeMood };
