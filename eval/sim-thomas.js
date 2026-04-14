import { buildSystemPrompt } from '../lib/prompt.js';
import { getPersona } from '../lib/knowledge.js';

const p = getPersona();

const scenarios = [
  {
    name: 'Premier contact apres commentaire',
    scenario: 'default',
    messages: [{ role: 'user', content: "Salut Thomas, j'ai vu ton post sur LinkedIn, super interessant !" }],
    expectKnowledge: false,
  },
  {
    name: 'Question acquisition LinkedIn',
    scenario: 'default',
    messages: [{ role: 'user', content: 'Comment tu fais pour generer 60 RDV par mois sur LinkedIn ?' }],
    expectKnowledge: true,
    expectTopics: ['gtm-linkedin'],
  },
  {
    name: 'Qualification lead B2B',
    scenario: 'qualification',
    messages: [{ role: 'user', content: "Salut, je suis fondateur d'une agence de dev. On a du mal a trouver des clients." }],
    expectKnowledge: false,
  },
  {
    name: 'Question contenu LinkedIn',
    scenario: 'default',
    messages: [{ role: 'user', content: 'Je ne sais pas quoi poster sur LinkedIn, syndrome de la page blanche.' }],
    expectKnowledge: true,
    expectTopics: ['contenu-linkedin'],
  },
  {
    name: 'Hors sujet (crypto)',
    scenario: 'default',
    messages: [{ role: 'user', content: 'Tu penses quoi du Bitcoin en ce moment ?' }],
    expectKnowledge: false,
  },
];

let total = 0, passed = 0;

function check(name, condition) {
  total++;
  if (condition) { passed++; console.log(`  PASS | ${name}`); }
  else { console.log(`  FAIL | ${name}`); }
}

console.log(`\nPersona: ${p.name}`);
console.log(`Forbidden words: ${p.voice.forbiddenWords.length}`);
console.log(`Writing rules: ${p.voice.writingRules.length}`);
console.log(`neverDoes: ${p.voice.neverDoes.length}\n`);

for (const s of scenarios) {
  console.log(`\n=== ${s.name} ===`);
  const r = buildSystemPrompt(s.scenario, s.messages);

  check('Identity: Thomas Nurit', r.prompt.includes('Thomas Nurit'));
  check('No Alex leak', !r.prompt.includes('Alex Renaud'));
  check('Voice rules present', r.prompt.includes('REGLES DE VOIX'));
  check('Scenario loaded', r.prompt.includes('INSTRUCTIONS DU SCENARIO'));
  check('Forbidden words in prompt', r.prompt.includes('cordialement'));
  check('Writing rules in prompt', r.prompt.includes('Messages ultra-courts') || r.prompt.includes('question par message'));

  if (s.expectKnowledge) {
    check('Knowledge detected', r.detectedPages.length > 0);
    if (s.expectTopics) {
      for (const topic of s.expectTopics) {
        check(`Topic: ${topic}`, r.detectedPages.some(p => p.includes(topic)));
      }
    }
  } else {
    // No specific knowledge expected — still OK if some matches
    console.log(`  INFO | Knowledge pages: ${r.detectedPages.length > 0 ? r.detectedPages.join(', ') : 'none'}`);
  }

  // Check prompt would produce Thomas-like response
  if (s.scenario === 'qualification') {
    check('Qualification: has entonnoir', r.prompt.includes('entonnoir'));
    check('Qualification: has CTA calendrier', r.prompt.includes('calendrier'));
    check('Qualification: has disqualify rule', r.prompt.includes('disqualifier'));
  }

  console.log(`  Prompt: ${r.prompt.length} chars`);
}

// Thomas-specific voice DNA deep checks
console.log('\n=== VOICE DNA DEEP CHECK ===');
const r = buildSystemPrompt('default', [{ role: 'user', content: 'test' }]);

check(';) in signature phrases', p.voice.signaturePhrases.some(s => s.includes(';)')));
check('"Yes" english mix in rules', p.voice.writingRules.some(r => r.includes('Yes')));
check('"Nice" english mix in rules', p.voice.writingRules.some(r => r.includes('Nice')));
check('Niiicce in signatures', p.voice.signaturePhrases.some(s => s.includes('Niiicce')));
check('Vendeur de tapis humor', p.voice.signaturePhrases.some(s => s.includes('vendeur de tapis')));
check('Navre pour le delai in rules', p.voice.writingRules.some(r => r.includes('Navre') || r.includes('retard')));
check('No emoji spam in neverDoes', p.voice.neverDoes.some(r => r.includes('emoji') || r.includes('Spam')));
check('No hard sell in neverDoes', p.voice.neverDoes.some(r => r.includes('Hard sell') || r.includes('hard sell')));

console.log(`\n--- Final Score: ${passed}/${total} (${Math.round(passed/total*100)}%) ---`);
process.exit(passed === total ? 0 : 1);
