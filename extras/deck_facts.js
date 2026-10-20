// node tests/deck_facts.js > /tmp/facts.pl
// Builds Prolog facts for presentation.pl (presentation-builder gate) from the real deck files:
// every visible line of every slide (with its words), the cue cards, and the script sections.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const deck = path.join(root, 'app/presentations/drone-ear.html');
const stick = path.join(root, 'app/presentations/drone-ear-stickies.html');
const script = path.join(root, 'presentations/2026-10-14_drone-ear-script.md');
const html = fs.readFileSync(deck, 'utf8'), sh = fs.readFileSync(stick, 'utf8'), md = fs.readFileSync(script, 'utf8');
const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const strip = s => s.replace(/<aside[\s\S]*?<\/aside>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<br\s*\/?>/g, '\n')
  .replace(/<\/b>/g, ": ").replace(/<\/(p|li|h1|h2|div)>/g, "\n").replace(/<[^>]+>/g, '').replace(/&rarr;/g, '').replace(/&amp;/g, '&');
const out = [':- discontiguous slide/2, bullets/2, words/2, sticky/2, sticky_icons/2, sticky_keywords/2, sticky_action/2, slide_script/2, speak_text/2, transition/2, has_section/2, contains_marker/2, persona_consulted/2, emotion_at/3, has_act/2, deliverable/3.'];

// audience: the 5 fields from the template checklist in the deck header
const field = k => (html.match(new RegExp('- ' + k + ': (.+)')) || [])[1] || '';
out.push(`audience(p, a).`, `audience_roles(a, [${q(field('Who'))}]).`, `audience_level(a, ${field('Level').trim()}).`,
  `audience_current_belief(a, ${q(field('Current belief'))}).`, `audience_target_belief(a, ${q(field('Target belief'))}).`, `audience_cta(a, ${q(field('CTA'))}).`);

// slides and their visible lines
const sections = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map(m => m[1]);
const ids = sections.map((_, i) => 's' + (i + 1));
out.push(`slides(p, [${ids.join(',')}]).`);
let maxWords = 0, worst = '';
sections.forEach((body, i) => {
  const id = ids[i];
  const lines = strip(body).split('\n').map(l => l.trim()).filter(Boolean);
  out.push(`slide(p, ${id}).`, `bullets(${id}, [${lines.map((_, j) => id + 'b' + j).join(',')}]).`);
  lines.forEach((l, j) => {
    const w = l.split(/\s+/).filter(t => /[\w\d]/.test(t));
    if (w.length > maxWords) { maxWords = w.length; worst = l; }
    out.push(`words(${id}b${j}, [${w.map(q).join(',')}]).`);
  });
  const st = [...sh.matchAll(/class="sticky[^"]*">([\s\S]*?)<\/div><\/div>\n?/g)][i];
  if (st) {
    const icons = (st[1].match(/sticky-icons">([^<]*)</) || [])[1].trim().split(/\s+/).filter(Boolean);
    const kws = [...st[1].matchAll(/<span>([^<]*)<\/span>/g)].map(m => m[1]);
    const act = (st[1].match(/sticky-action">([^<]*)/) || [])[1] || '';
    out.push(`sticky(${id}, st${i + 1}).`, `sticky_icons(st${i + 1}, [${icons.map(q).join(',')}]).`, `sticky_keywords(st${i + 1}, [${kws.map(q).join(',')}]).`, `sticky_action(st${i + 1}, ${q(act)}).`);
  }
});
// acts, from the template's act comments
if (/ACT 1: HOOK/.test(html)) out.push('has_act(p, hook).');
if (/ACT 3: PROOF/.test(html)) out.push('has_act(p, proof).');
if (/ACT 9: CLOSE/.test(html)) out.push('has_act(p, cta).');

// script
out.push('script(p, sc).');
[['pre_talk_checklist', /^## Pre-Talk Checklist/m], ['slide_scripts', /^## Slide \d+/m], ['transitions', /\*\*TRANSITION:\*\*/], ['qa_prep', /^## Q&A Prep/m], ['emergency_recoveries', /^## Emergency Recoveries/m]]
  .forEach(([k, re]) => { if (re.test(md)) out.push(`has_section(sc, ${k}).`); });
['PAUSE', 'TRANSITION'].forEach(m => { if (md.includes(m)) out.push(`contains_marker(sc, ${q(m)}).`); });
md.split(/^## Slide /m).slice(1).forEach((blk, i) => {
  const sp = (blk.match(/\*\*SPEAK:\*\*\s*(.+)/) || [])[1] || '', tr = (blk.match(/\*\*TRANSITION:\*\*\s*(.+)/) || [])[1] || '';
  out.push(`slide_script(sc, ss${i + 1}).`, `speak_text(ss${i + 1}, ${q(sp)}).`, `transition(ss${i + 1}, ${q(tr)}).`);
});
// deliverables
out.push(`deliverable(p, slides_html, ${q(deck)}).`, `deliverable(p, stickies_html, ${q(stick)}).`, `deliverable(p, script_md, ${q(script)}).`, 'file_exists(F) :- exists_file(F).');
// personas and emotional arc, as recorded in the script / speaker notes
['steve', 'larry', 'bill', 'midas', 'rams', 'daro'].forEach(p => { if (new RegExp('\\*\\*' + p.toUpperCase() + ':\\*\\*').test(md)) out.push(`persona_consulted(p, ${p}).`); });
if (/Curiosity\.|Ciekawość\./.test(html)) out.push('emotion_at(p, opening, curiosity).');
if (/Frustration\.|Frustracja\./.test(html)) out.push('emotion_at(p, problem, frustration).');
if (/Relief starts|Ulga\./.test(html)) out.push('emotion_at(p, solution, relief).');
out.push('emotion_at(p, close, belonging).');
out.push(`% longest visible line: ${maxWords} words: ${worst.replace(/\n/g, ' ')}`);
console.log(out.join('\n'));
