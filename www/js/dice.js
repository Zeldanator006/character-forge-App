/* Reads a spell's rules text to find what to roll: attack, saving throw, damage or healing dice.

   Ported from the PC app's dice.py; tests/helpers.test.mjs checks both give the same answers.
   This is pattern matching on ordinary 5e wording ("takes 8d6 fire damage", "increases by 1d6
   for each slot level above 3rd"), so unusual spells may come back with nothing to roll. */
import { NAME_TO_ABILITY } from './srd.js';

export const DAMAGE_TYPES = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const DAMAGE_RE = new RegExp(`(\\d+d\\d+)(?:\\s*\\+\\s*(?:(your spellcasting ability modifier)|(\\d+)))?\\s+(${DAMAGE_TYPES})\\s+damage`, 'i');
const UNTYPED_DAMAGE_RE = /(\d+d\d+)(?:\s*\+\s*(\d+))?\s+damage/i;
const HEAL_RE = /regains?\s+(?:a number of\s+)?hit points equal to\s+(\d+d\d+)(\s*\+\s*your spellcasting ability modifier)?/i;
const ATTACK_RE = /\b(melee|ranged) spell attack/i;
const SAVE_RE = /\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i;
const UPCAST_RE = /increases by (\d+d\d+) for each (?:spell )?slot level above (\d)(?:st|nd|rd|th)/i;

export const cantripTier = (charLevel) => (charLevel >= 17 ? 4 : charLevel >= 11 ? 3 : charLevel >= 5 ? 2 : 1);

export function spellEffect(data, charLevel = 1) {
  const desc = data.description || data.text || '';
  const higher = data.higher_levels || '';
  const level = data.level || 0;
  const out = { level, attack: null, save: null, half: false, damage: null, heal: null,
    per_slot: null, base_level: level, note: '' };
  let m = desc.match(ATTACK_RE);
  if (m) out.attack = m[1].toLowerCase();
  m = desc.match(SAVE_RE);
  if (m) {
    out.save = NAME_TO_ABILITY[m[1].toLowerCase()];
    out.half = /half as much damage/i.test(desc);
  }
  m = desc.match(DAMAGE_RE);
  if (m) {
    out.damage = { dice: m[1], flat: parseInt(m[3] || '0', 10), add_mod: Boolean(m[2]), type: m[4].toLowerCase() };
  } else {
    m = desc.match(UNTYPED_DAMAGE_RE);
    if (m) out.damage = { dice: m[1], flat: parseInt(m[2] || '0', 10), add_mod: false, type: '' };
  }
  m = desc.match(HEAL_RE);
  if (m) out.heal = { dice: m[1], add_mod: Boolean(m[2]) };
  m = higher.match(UPCAST_RE) || desc.match(UPCAST_RE);
  if (m && level) {
    out.per_slot = m[1];
    out.base_level = parseInt(m[2], 10);
  }
  if (level === 0 && out.damage && /5th level/.test(`${desc} ${higher}`)) {
    const tier = cantripTier(charLevel);
    if (/more than one beam|\bbeams\b/i.test(`${desc} ${higher}`)) {
      out.beams = tier;
      if (tier > 1) out.note = `${tier} beams at your level: roll the attack and damage once per beam.`;
    } else if (tier > 1) {
      const [count, sides] = out.damage.dice.split('d');
      out.damage.dice = `${parseInt(count, 10) * tier}d${sides}`;
      out.note = `Damage includes the cantrip increase for a level ${charLevel} character.`;
    }
  }
  return out;
}
