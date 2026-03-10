// backend/services/missionSuggester.js
// Uses Groq (free) for AI-powered mission suggestions

let groqClient = null;
function getGroq() {
  if (!groqClient && process.env.GROQ_API_KEY) {
    const Groq = require('groq-sdk');
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

const STATIC_SUGGESTIONS = [
  { title: 'Morning Run', category: 'Get Fit', emoji: '🏃', durationDays: 7,
    dailyChecklist: ['Run for 20 minutes', 'Take a post-run photo'],
    proofType: 'photo', whyForYou: 'Build your first fitness streak — 7 days is the perfect entry point.' },
  { title: 'Deep Work Sprint', category: 'Study Discipline', emoji: '📚', durationDays: 14,
    dailyChecklist: ['2 hours focused work with no phone', 'Screenshot your progress'],
    proofType: 'photo', whyForYou: 'Two focused weeks will rewire your concentration muscle.' },
  { title: 'Wake Up at 6am', category: 'Wake Up Early', emoji: '🌅', durationDays: 21,
    dailyChecklist: ['Out of bed by 6am', 'Photo of morning sky or workspace'],
    proofType: 'photo', whyForYou: 'Mornings are the ultimate leverage point — 21 days locks it in.' },
];

async function getSuggestedMissions(user, pastMissions) {
  const groq = getGroq();
  if (!groq) return STATIC_SUGGESTIONS;

  try {
    const completed = pastMissions.filter(m => m.status === 'completed').map(m => m.category);
    const failed    = pastMissions.filter(m => m.status === 'failed').map(m => m.category);
    const bestStreak = Math.max(...pastMissions.map(m => m.analytics?.bestStreak || 0), 0);

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `You are a goal coach for a mission-tracking app. Suggest 3 personalized missions.

USER:
- Identity goal: ${user.onboardingData?.identity || 'not set'}
- Completed categories: ${completed.join(', ') || 'none yet'}
- Struggled with: ${failed.join(', ') || 'none'}
- Best streak: ${bestStreak} days
- App level: ${user.level || 1}

RULES:
- Level 1-3 or no history → suggest 7-day missions
- Best streak > 14 → suggest 21-day
- Best streak > 21 → suggest 30-day
- If a category was failed before → suggest shorter/easier version of it
- Checklist: max 2 specific, achievable daily actions

Return ONLY a JSON array, no markdown, no preamble:
[{"title":"string","category":"Get Fit|Wake Up Early|Study Discipline|Earn Money|Create Content|Launch Project|Custom Mission","emoji":"single emoji","description":"1-2 sentences","durationDays":7,"dailyChecklist":["action1","action2"],"proofType":"photo","whyForYou":"personalized 1-sentence reason"}]`,
      }],
      max_tokens: 800, temperature: 0.7,
    });

    const text = completion.choices[0].message.content.trim().replace(/```json|```/g, '');
    return JSON.parse(text);
  } catch (err) {
    console.error('AI suggest error:', err.message);
    return STATIC_SUGGESTIONS;
  }
}

async function generateMissionFromText(rawText, user) {
  const groq = getGroq();
  if (!groq) {
    return {
      title: 'My 30-Day Mission',
      category: 'Custom Mission',
      emoji: '🎯',
      description: rawText,
      durationDays: 30,
      dailyChecklist: ['Do the work', 'Upload your proof'],
      proofType: 'photo',
    };
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `Convert this goal description into a structured mission for a daily proof-based goal app.

User's goal: "${rawText}"

Return ONLY valid JSON, no markdown:
{
  "title": "short catchy mission title (max 5 words)",
  "category": "one of: Get Fit|Wake Up Early|Study Discipline|Earn Money|Create Content|Launch Project|Custom Mission",
  "emoji": "single most relevant emoji",
  "description": "1 motivating sentence about this mission",
  "durationDays": 7 or 14 or 21 or 30,
  "dailyChecklist": ["specific action 1 (max 8 words)", "specific action 2 (max 8 words)"],
  "proofType": "photo",
  "motivation": "1 sentence why this will change them"
}`,
      }],
      max_tokens: 400, temperature: 0.5,
    });

    const text = completion.choices[0].message.content.trim().replace(/```json|```/g, '');
    return JSON.parse(text);
  } catch (err) {
    console.error('AI generate mission error:', err.message);
    return {
      title: 'My Mission',
      category: 'Custom Mission',
      emoji: '🎯',
      description: rawText,
      durationDays: 30,
      dailyChecklist: ['Do the work today', 'Upload proof'],
      proofType: 'photo',
      motivation: 'Every day counts.',
    };
  }
}

module.exports = { getSuggestedMissions, generateMissionFromText };
