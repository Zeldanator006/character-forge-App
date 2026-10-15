/* Equipment: the item catalog, class starting equipment, and turning equipment text into items.

   Ported from the PC app's gear.py (and the magic-item effect reader in wikiparse.py); tests/gear.test.mjs
   checks both give the same answers. Costs and weights follow the System Reference Document 5.1 (CC-BY-4.0).
   Costs are in copper pieces (1 gp = 100 cp). Starting equipment follows the 2014 Player's Handbook class entries. */
import { ABILITIES, ARMOR, WEAPONS } from './srd.js';
import { T, or, get, isDict, pyStr, jsonKey, int, toFloat, round, fmtG, capitalize, sorted, list, fsum, max2,
  setdefault } from './py.js';

export const GP = 100;
export const SP = 10;
export const CP = 1;
export const WEAPON_COST = {"Unarmed strike": [0, 0], "Club": [10, 2], "Dagger": [200, 1], "Greatclub": [20, 10], "Handaxe": [500, 2], "Javelin": [50, 2], "Light hammer": [200, 2], "Mace": [500, 4], "Quarterstaff": [20, 4], "Sickle": [100, 2], "Spear": [100, 3], "Light crossbow": [2500, 5], "Dart": [5, 0.25], "Shortbow": [2500, 2], "Sling": [10, 0], "Battleaxe": [1000, 4], "Flail": [1000, 2], "Glaive": [2000, 6], "Greataxe": [3000, 7], "Greatsword": [5000, 6], "Halberd": [2000, 6], "Lance": [1000, 6], "Longsword": [1500, 3], "Maul": [1000, 10], "Morningstar": [1500, 4], "Pike": [500, 18], "Rapier": [2500, 2], "Scimitar": [2500, 3], "Shortsword": [1000, 2], "Trident": [500, 4], "War pick": [500, 2], "Warhammer": [1500, 2], "Whip": [200, 3], "Blowgun": [1000, 1], "Hand crossbow": [7500, 3], "Heavy crossbow": [5000, 18], "Longbow": [5000, 2]};
export const ARMOR_COST = {"Padded": [500, 8], "Leather": [1000, 10], "Studded leather": [4500, 13], "Hide": [1000, 12], "Chain shirt": [5000, 20], "Scale mail": [5000, 45], "Breastplate": [40000, 20], "Half plate": [75000, 40], "Ring mail": [3000, 40], "Chain mail": [7500, 55], "Splint": [20000, 60], "Plate": [150000, 65], "Shield": [1000, 6]};
export const GEAR = {"Abacus": {"name": "Abacus", "kind": "gear", "cost_cp": 200, "weight": 2, "per": 1}, "Acid (vial)": {"name": "Acid (vial)", "kind": "consumable", "cost_cp": 2500, "weight": 1, "per": 1}, "Alchemist's fire (flask)": {"name": "Alchemist's fire (flask)", "kind": "consumable", "cost_cp": 5000, "weight": 1, "per": 1}, "Antitoxin (vial)": {"name": "Antitoxin (vial)", "kind": "consumable", "cost_cp": 5000, "weight": 0, "per": 1}, "Arrow": {"name": "Arrow", "kind": "ammo", "cost_cp": 100, "weight": 1, "per": 20}, "Blowgun needle": {"name": "Blowgun needle", "kind": "ammo", "cost_cp": 100, "weight": 1, "per": 50}, "Crossbow bolt": {"name": "Crossbow bolt", "kind": "ammo", "cost_cp": 100, "weight": 1.5, "per": 20}, "Sling bullet": {"name": "Sling bullet", "kind": "ammo", "cost_cp": 4, "weight": 1.5, "per": 20}, "Arcane focus (crystal)": {"name": "Arcane focus (crystal)", "kind": "focus", "cost_cp": 1000, "weight": 1, "per": 1}, "Arcane focus (orb)": {"name": "Arcane focus (orb)", "kind": "focus", "cost_cp": 2000, "weight": 3, "per": 1}, "Arcane focus (rod)": {"name": "Arcane focus (rod)", "kind": "focus", "cost_cp": 1000, "weight": 2, "per": 1}, "Arcane focus (staff)": {"name": "Arcane focus (staff)", "kind": "focus", "cost_cp": 500, "weight": 4, "per": 1}, "Arcane focus (wand)": {"name": "Arcane focus (wand)", "kind": "focus", "cost_cp": 1000, "weight": 1, "per": 1}, "Backpack": {"name": "Backpack", "kind": "gear", "cost_cp": 200, "weight": 5, "per": 1}, "Ball bearings (bag of 1000)": {"name": "Ball bearings (bag of 1000)", "kind": "gear", "cost_cp": 100, "weight": 2, "per": 1}, "Barrel": {"name": "Barrel", "kind": "gear", "cost_cp": 200, "weight": 70, "per": 1}, "Basket": {"name": "Basket", "kind": "gear", "cost_cp": 40, "weight": 2, "per": 1}, "Bedroll": {"name": "Bedroll", "kind": "gear", "cost_cp": 100, "weight": 7, "per": 1}, "Bell": {"name": "Bell", "kind": "gear", "cost_cp": 100, "weight": 0, "per": 1}, "Blanket": {"name": "Blanket", "kind": "gear", "cost_cp": 50, "weight": 3, "per": 1}, "Block and tackle": {"name": "Block and tackle", "kind": "gear", "cost_cp": 100, "weight": 5, "per": 1}, "Book": {"name": "Book", "kind": "gear", "cost_cp": 2500, "weight": 5, "per": 1}, "Glass bottle": {"name": "Glass bottle", "kind": "gear", "cost_cp": 200, "weight": 2, "per": 1}, "Bucket": {"name": "Bucket", "kind": "gear", "cost_cp": 5, "weight": 2, "per": 1}, "Caltrops (bag of 20)": {"name": "Caltrops (bag of 20)", "kind": "gear", "cost_cp": 100, "weight": 2, "per": 1}, "Candle": {"name": "Candle", "kind": "gear", "cost_cp": 1, "weight": 0, "per": 1}, "Crossbow bolt case": {"name": "Crossbow bolt case", "kind": "gear", "cost_cp": 100, "weight": 1, "per": 1}, "Map or scroll case": {"name": "Map or scroll case", "kind": "gear", "cost_cp": 100, "weight": 1, "per": 1}, "Chain (10 feet)": {"name": "Chain (10 feet)", "kind": "gear", "cost_cp": 500, "weight": 10, "per": 1}, "Chalk": {"name": "Chalk", "kind": "gear", "cost_cp": 1, "weight": 0, "per": 1}, "Chest": {"name": "Chest", "kind": "gear", "cost_cp": 500, "weight": 25, "per": 1}, "Climber's kit": {"name": "Climber's kit", "kind": "gear", "cost_cp": 2500, "weight": 12, "per": 1}, "Common clothes": {"name": "Common clothes", "kind": "gear", "cost_cp": 50, "weight": 3, "per": 1}, "Costume clothes": {"name": "Costume clothes", "kind": "gear", "cost_cp": 500, "weight": 4, "per": 1}, "Fine clothes": {"name": "Fine clothes", "kind": "gear", "cost_cp": 1500, "weight": 6, "per": 1}, "Traveler's clothes": {"name": "Traveler's clothes", "kind": "gear", "cost_cp": 200, "weight": 4, "per": 1}, "Component pouch": {"name": "Component pouch", "kind": "focus", "cost_cp": 2500, "weight": 2, "per": 1}, "Crowbar": {"name": "Crowbar", "kind": "gear", "cost_cp": 200, "weight": 5, "per": 1}, "Druidic focus (sprig of mistletoe)": {"name": "Druidic focus (sprig of mistletoe)", "kind": "focus", "cost_cp": 100, "weight": 0, "per": 1}, "Druidic focus (totem)": {"name": "Druidic focus (totem)", "kind": "focus", "cost_cp": 100, "weight": 0, "per": 1}, "Druidic focus (wooden staff)": {"name": "Druidic focus (wooden staff)", "kind": "focus", "cost_cp": 500, "weight": 4, "per": 1}, "Druidic focus (yew wand)": {"name": "Druidic focus (yew wand)", "kind": "focus", "cost_cp": 1000, "weight": 1, "per": 1}, "Fishing tackle": {"name": "Fishing tackle", "kind": "gear", "cost_cp": 100, "weight": 4, "per": 1}, "Flask or tankard": {"name": "Flask or tankard", "kind": "gear", "cost_cp": 2, "weight": 1, "per": 1}, "Grappling hook": {"name": "Grappling hook", "kind": "gear", "cost_cp": 200, "weight": 4, "per": 1}, "Hammer": {"name": "Hammer", "kind": "gear", "cost_cp": 100, "weight": 3, "per": 1}, "Sledgehammer": {"name": "Sledgehammer", "kind": "gear", "cost_cp": 200, "weight": 10, "per": 1}, "Healer's kit": {"name": "Healer's kit", "kind": "gear", "cost_cp": 500, "weight": 3, "per": 1}, "Holy symbol (amulet)": {"name": "Holy symbol (amulet)", "kind": "focus", "cost_cp": 500, "weight": 1, "per": 1}, "Holy symbol (emblem)": {"name": "Holy symbol (emblem)", "kind": "focus", "cost_cp": 500, "weight": 0, "per": 1}, "Holy symbol (reliquary)": {"name": "Holy symbol (reliquary)", "kind": "focus", "cost_cp": 500, "weight": 2, "per": 1}, "Holy water (flask)": {"name": "Holy water (flask)", "kind": "consumable", "cost_cp": 2500, "weight": 1, "per": 1}, "Hourglass": {"name": "Hourglass", "kind": "gear", "cost_cp": 2500, "weight": 1, "per": 1}, "Hunting trap": {"name": "Hunting trap", "kind": "gear", "cost_cp": 500, "weight": 25, "per": 1}, "Ink (1-ounce bottle)": {"name": "Ink (1-ounce bottle)", "kind": "gear", "cost_cp": 1000, "weight": 0, "per": 1}, "Ink pen": {"name": "Ink pen", "kind": "gear", "cost_cp": 2, "weight": 0, "per": 1}, "Jug or pitcher": {"name": "Jug or pitcher", "kind": "gear", "cost_cp": 2, "weight": 4, "per": 1}, "Ladder (10-foot)": {"name": "Ladder (10-foot)", "kind": "gear", "cost_cp": 10, "weight": 25, "per": 1}, "Lamp": {"name": "Lamp", "kind": "gear", "cost_cp": 50, "weight": 1, "per": 1}, "Bullseye lantern": {"name": "Bullseye lantern", "kind": "gear", "cost_cp": 1000, "weight": 2, "per": 1}, "Hooded lantern": {"name": "Hooded lantern", "kind": "gear", "cost_cp": 500, "weight": 2, "per": 1}, "Lock": {"name": "Lock", "kind": "gear", "cost_cp": 1000, "weight": 1, "per": 1}, "Magnifying glass": {"name": "Magnifying glass", "kind": "gear", "cost_cp": 10000, "weight": 0, "per": 1}, "Manacles": {"name": "Manacles", "kind": "gear", "cost_cp": 200, "weight": 6, "per": 1}, "Mess kit": {"name": "Mess kit", "kind": "gear", "cost_cp": 20, "weight": 1, "per": 1}, "Steel mirror": {"name": "Steel mirror", "kind": "gear", "cost_cp": 500, "weight": 0.5, "per": 1}, "Oil (flask)": {"name": "Oil (flask)", "kind": "consumable", "cost_cp": 10, "weight": 1, "per": 1}, "Paper": {"name": "Paper", "kind": "gear", "cost_cp": 20, "weight": 0, "per": 1}, "Parchment": {"name": "Parchment", "kind": "gear", "cost_cp": 10, "weight": 0, "per": 1}, "Perfume (vial)": {"name": "Perfume (vial)", "kind": "gear", "cost_cp": 500, "weight": 0, "per": 1}, "Miner's pick": {"name": "Miner's pick", "kind": "gear", "cost_cp": 200, "weight": 10, "per": 1}, "Piton": {"name": "Piton", "kind": "gear", "cost_cp": 5, "weight": 0.25, "per": 1}, "Basic poison (vial)": {"name": "Basic poison (vial)", "kind": "consumable", "cost_cp": 10000, "weight": 0, "per": 1}, "Pole (10-foot)": {"name": "Pole (10-foot)", "kind": "gear", "cost_cp": 5, "weight": 7, "per": 1}, "Iron pot": {"name": "Iron pot", "kind": "gear", "cost_cp": 200, "weight": 10, "per": 1}, "Potion of healing": {"name": "Potion of healing", "kind": "consumable", "cost_cp": 5000, "weight": 0.5, "per": 1}, "Pouch": {"name": "Pouch", "kind": "gear", "cost_cp": 50, "weight": 1, "per": 1}, "Quiver": {"name": "Quiver", "kind": "gear", "cost_cp": 100, "weight": 1, "per": 1}, "Portable ram": {"name": "Portable ram", "kind": "gear", "cost_cp": 400, "weight": 35, "per": 1}, "Rations (1 day)": {"name": "Rations (1 day)", "kind": "consumable", "cost_cp": 50, "weight": 2, "per": 1}, "Robes": {"name": "Robes", "kind": "gear", "cost_cp": 100, "weight": 4, "per": 1}, "Hempen rope (50 feet)": {"name": "Hempen rope (50 feet)", "kind": "gear", "cost_cp": 100, "weight": 10, "per": 1}, "Silk rope (50 feet)": {"name": "Silk rope (50 feet)", "kind": "gear", "cost_cp": 1000, "weight": 5, "per": 1}, "Sack": {"name": "Sack", "kind": "gear", "cost_cp": 1, "weight": 0.5, "per": 1}, "Merchant's scale": {"name": "Merchant's scale", "kind": "gear", "cost_cp": 500, "weight": 3, "per": 1}, "Sealing wax": {"name": "Sealing wax", "kind": "gear", "cost_cp": 50, "weight": 0, "per": 1}, "Shovel": {"name": "Shovel", "kind": "gear", "cost_cp": 200, "weight": 5, "per": 1}, "Signal whistle": {"name": "Signal whistle", "kind": "gear", "cost_cp": 5, "weight": 0, "per": 1}, "Signet ring": {"name": "Signet ring", "kind": "gear", "cost_cp": 500, "weight": 0, "per": 1}, "Soap": {"name": "Soap", "kind": "gear", "cost_cp": 2, "weight": 0, "per": 1}, "Spellbook": {"name": "Spellbook", "kind": "focus", "cost_cp": 5000, "weight": 3, "per": 1}, "Iron spikes (10)": {"name": "Iron spikes (10)", "kind": "gear", "cost_cp": 100, "weight": 5, "per": 1}, "Spyglass": {"name": "Spyglass", "kind": "gear", "cost_cp": 100000, "weight": 1, "per": 1}, "Two-person tent": {"name": "Two-person tent", "kind": "gear", "cost_cp": 200, "weight": 20, "per": 1}, "Tinderbox": {"name": "Tinderbox", "kind": "gear", "cost_cp": 50, "weight": 1, "per": 1}, "Torch": {"name": "Torch", "kind": "consumable", "cost_cp": 1, "weight": 1, "per": 1}, "Vial": {"name": "Vial", "kind": "gear", "cost_cp": 100, "weight": 0, "per": 1}, "Waterskin": {"name": "Waterskin", "kind": "gear", "cost_cp": 20, "weight": 5, "per": 1}, "Whetstone": {"name": "Whetstone", "kind": "gear", "cost_cp": 1, "weight": 1, "per": 1}, "Alchemist's supplies": {"name": "Alchemist's supplies", "kind": "tool", "cost_cp": 5000, "weight": 8, "per": 1}, "Brewer's supplies": {"name": "Brewer's supplies", "kind": "tool", "cost_cp": 2000, "weight": 9, "per": 1}, "Calligrapher's supplies": {"name": "Calligrapher's supplies", "kind": "tool", "cost_cp": 1000, "weight": 5, "per": 1}, "Carpenter's tools": {"name": "Carpenter's tools", "kind": "tool", "cost_cp": 800, "weight": 6, "per": 1}, "Cartographer's tools": {"name": "Cartographer's tools", "kind": "tool", "cost_cp": 1500, "weight": 6, "per": 1}, "Cobbler's tools": {"name": "Cobbler's tools", "kind": "tool", "cost_cp": 500, "weight": 5, "per": 1}, "Cook's utensils": {"name": "Cook's utensils", "kind": "tool", "cost_cp": 100, "weight": 8, "per": 1}, "Glassblower's tools": {"name": "Glassblower's tools", "kind": "tool", "cost_cp": 3000, "weight": 5, "per": 1}, "Jeweler's tools": {"name": "Jeweler's tools", "kind": "tool", "cost_cp": 2500, "weight": 2, "per": 1}, "Leatherworker's tools": {"name": "Leatherworker's tools", "kind": "tool", "cost_cp": 500, "weight": 5, "per": 1}, "Mason's tools": {"name": "Mason's tools", "kind": "tool", "cost_cp": 1000, "weight": 8, "per": 1}, "Painter's supplies": {"name": "Painter's supplies", "kind": "tool", "cost_cp": 1000, "weight": 5, "per": 1}, "Potter's tools": {"name": "Potter's tools", "kind": "tool", "cost_cp": 1000, "weight": 3, "per": 1}, "Smith's tools": {"name": "Smith's tools", "kind": "tool", "cost_cp": 2000, "weight": 8, "per": 1}, "Tinker's tools": {"name": "Tinker's tools", "kind": "tool", "cost_cp": 5000, "weight": 10, "per": 1}, "Weaver's tools": {"name": "Weaver's tools", "kind": "tool", "cost_cp": 100, "weight": 5, "per": 1}, "Woodcarver's tools": {"name": "Woodcarver's tools", "kind": "tool", "cost_cp": 100, "weight": 5, "per": 1}, "Disguise kit": {"name": "Disguise kit", "kind": "tool", "cost_cp": 2500, "weight": 3, "per": 1}, "Forgery kit": {"name": "Forgery kit", "kind": "tool", "cost_cp": 1500, "weight": 5, "per": 1}, "Dice set": {"name": "Dice set", "kind": "tool", "cost_cp": 10, "weight": 0, "per": 1}, "Playing card set": {"name": "Playing card set", "kind": "tool", "cost_cp": 50, "weight": 0, "per": 1}, "Herbalism kit": {"name": "Herbalism kit", "kind": "tool", "cost_cp": 500, "weight": 3, "per": 1}, "Navigator's tools": {"name": "Navigator's tools", "kind": "tool", "cost_cp": 2500, "weight": 2, "per": 1}, "Poisoner's kit": {"name": "Poisoner's kit", "kind": "tool", "cost_cp": 5000, "weight": 2, "per": 1}, "Thieves' tools": {"name": "Thieves' tools", "kind": "tool", "cost_cp": 2500, "weight": 1, "per": 1}, "Bagpipes": {"name": "Bagpipes", "kind": "instrument", "cost_cp": 3000, "weight": 6, "per": 1}, "Drum": {"name": "Drum", "kind": "instrument", "cost_cp": 600, "weight": 3, "per": 1}, "Dulcimer": {"name": "Dulcimer", "kind": "instrument", "cost_cp": 2500, "weight": 10, "per": 1}, "Flute": {"name": "Flute", "kind": "instrument", "cost_cp": 200, "weight": 1, "per": 1}, "Horn": {"name": "Horn", "kind": "instrument", "cost_cp": 300, "weight": 2, "per": 1}, "Lute": {"name": "Lute", "kind": "instrument", "cost_cp": 3500, "weight": 2, "per": 1}, "Lyre": {"name": "Lyre", "kind": "instrument", "cost_cp": 3000, "weight": 2, "per": 1}, "Pan flute": {"name": "Pan flute", "kind": "instrument", "cost_cp": 1200, "weight": 2, "per": 1}, "Shawm": {"name": "Shawm", "kind": "instrument", "cost_cp": 200, "weight": 1, "per": 1}, "Viol": {"name": "Viol", "kind": "instrument", "cost_cp": 3000, "weight": 1, "per": 1}};
export const EXTRA = {"Trinket": 0, "String (10 feet)": 0, "Alms box": 1, "Incense (block)": 0, "Censer": 1, "Vestments": 4, "Book of lore": 5, "Little bag of sand": 1, "Small knife": 0.5};
export const PACKS = {"Burglar's pack": [1600, [["Backpack", 1], ["Ball bearings (bag of 1000)", 1], ["String (10 feet)", 1], ["Bell", 1], ["Candle", 5], ["Crowbar", 1], ["Hammer", 1], ["Piton", 10], ["Hooded lantern", 1], ["Oil (flask)", 2], ["Rations (1 day)", 5], ["Tinderbox", 1], ["Waterskin", 1], ["Hempen rope (50 feet)", 1]]], "Diplomat's pack": [3900, [["Chest", 1], ["Map or scroll case", 2], ["Fine clothes", 1], ["Ink (1-ounce bottle)", 1], ["Ink pen", 1], ["Lamp", 1], ["Oil (flask)", 2], ["Paper", 5], ["Perfume (vial)", 1], ["Sealing wax", 1], ["Soap", 1]]], "Dungeoneer's pack": [1200, [["Backpack", 1], ["Crowbar", 1], ["Hammer", 1], ["Piton", 10], ["Torch", 10], ["Tinderbox", 1], ["Rations (1 day)", 10], ["Waterskin", 1], ["Hempen rope (50 feet)", 1]]], "Entertainer's pack": [4000, [["Backpack", 1], ["Bedroll", 1], ["Costume clothes", 2], ["Candle", 5], ["Rations (1 day)", 5], ["Waterskin", 1], ["Disguise kit", 1]]], "Explorer's pack": [1000, [["Backpack", 1], ["Bedroll", 1], ["Mess kit", 1], ["Tinderbox", 1], ["Torch", 10], ["Rations (1 day)", 10], ["Waterskin", 1], ["Hempen rope (50 feet)", 1]]], "Priest's pack": [1900, [["Backpack", 1], ["Blanket", 1], ["Candle", 10], ["Tinderbox", 1], ["Alms box", 1], ["Incense (block)", 2], ["Censer", 1], ["Vestments", 1], ["Rations (1 day)", 2], ["Waterskin", 1]]], "Scholar's pack": [4000, [["Backpack", 1], ["Book of lore", 1], ["Ink (1-ounce bottle)", 1], ["Ink pen", 1], ["Parchment", 10], ["Little bag of sand", 1], ["Small knife", 1]]]};
export const FOCUS_CHOICES = {"arcane-focus": ["an arcane focus", ["Arcane focus (crystal)", "Arcane focus (orb)", "Arcane focus (rod)", "Arcane focus (staff)", "Arcane focus (wand)"]], "holy-symbol": ["a holy symbol", ["Holy symbol (amulet)", "Holy symbol (emblem)", "Holy symbol (reliquary)"]], "druidic-focus": ["a druidic focus", ["Druidic focus (sprig of mistletoe)", "Druidic focus (totem)", "Druidic focus (wooden staff)", "Druidic focus (yew wand)"]], "instrument": ["a musical instrument", ["Bagpipes", "Drum", "Dulcimer", "Flute", "Horn", "Lute", "Lyre", "Pan flute", "Shawm", "Viol"]], "artisan-tools": ["a set of artisan's tools", ["Alchemist's supplies", "Brewer's supplies", "Calligrapher's supplies", "Carpenter's tools", "Cartographer's tools", "Cobbler's tools", "Cook's utensils", "Glassblower's tools", "Jeweler's tools", "Leatherworker's tools", "Mason's tools", "Painter's supplies", "Potter's tools", "Smith's tools", "Tinker's tools", "Weaver's tools", "Woodcarver's tools"]], "gaming-set": ["a gaming set", ["Dice set", "Playing card set"]]};
export const ARTISAN_TOOLS = ["Alchemist's supplies", "Brewer's supplies", "Calligrapher's supplies", "Carpenter's tools", "Cartographer's tools", "Cobbler's tools", "Cook's utensils", "Glassblower's tools", "Jeweler's tools", "Leatherworker's tools", "Mason's tools", "Painter's supplies", "Potter's tools", "Smith's tools", "Tinker's tools", "Weaver's tools", "Woodcarver's tools"];
export const AMMO_FOR = {"Longbow": "Arrow", "Shortbow": "Arrow", "Light crossbow": "Crossbow bolt", "Hand crossbow": "Crossbow bolt", "Heavy crossbow": "Crossbow bolt", "Sling": "Sling bullet", "Blowgun": "Blowgun needle"};
export const STARTING_EQUIPMENT = {"artificer": [[["simple", "simple"]], [["Light crossbow", "Crossbow bolt*20"]], [["Studded leather"], ["Scale mail"]], [["Thieves' tools", "Dungeoneer's pack"]]], "barbarian": [[["Greataxe"], ["martial-melee"]], [["Handaxe*2"], ["simple"]], [["Explorer's pack", "Javelin*4"]]], "bard": [[["Rapier"], ["Longsword"], ["simple"]], [["Diplomat's pack"], ["Entertainer's pack"]], [["Lute"], ["instrument"]], [["Leather", "Dagger"]]], "cleric": [[["Mace"], ["Warhammer"]], [["Scale mail"], ["Leather"], ["Chain mail"]], [["Light crossbow", "Crossbow bolt*20"], ["simple"]], [["Priest's pack"], ["Explorer's pack"]], [["Shield", "holy-symbol"]]], "druid": [[["Shield"], ["simple"]], [["Scimitar"], ["simple-melee"]], [["Leather", "Explorer's pack", "druidic-focus"]]], "fighter": [[["Chain mail"], ["Leather", "Longbow", "Arrow*20"]], [["martial", "Shield"], ["martial", "martial"]], [["Light crossbow", "Crossbow bolt*20"], ["Handaxe*2"]], [["Dungeoneer's pack"], ["Explorer's pack"]]], "monk": [[["Shortsword"], ["simple"]], [["Dungeoneer's pack"], ["Explorer's pack"]], [["Dart*10"]]], "paladin": [[["martial", "Shield"], ["martial", "martial"]], [["Javelin*5"], ["simple-melee"]], [["Priest's pack"], ["Explorer's pack"]], [["Chain mail", "holy-symbol"]]], "ranger": [[["Scale mail"], ["Leather"]], [["Shortsword*2"], ["simple-melee", "simple-melee"]], [["Dungeoneer's pack"], ["Explorer's pack"]], [["Longbow", "Quiver", "Arrow*20"]]], "rogue": [[["Rapier"], ["Shortsword"]], [["Shortbow", "Quiver", "Arrow*20"], ["Shortsword"]], [["Burglar's pack"], ["Dungeoneer's pack"], ["Explorer's pack"]], [["Leather", "Dagger*2", "Thieves' tools"]]], "sorcerer": [[["Light crossbow", "Crossbow bolt*20"], ["simple"]], [["Component pouch"], ["arcane-focus"]], [["Dungeoneer's pack"], ["Explorer's pack"]], [["Dagger*2"]]], "warlock": [[["Light crossbow", "Crossbow bolt*20"], ["simple"]], [["Component pouch"], ["arcane-focus"]], [["Scholar's pack"], ["Dungeoneer's pack"]], [["Leather", "simple", "Dagger*2"]]], "wizard": [[["Quarterstaff"], ["Dagger"]], [["Component pouch"], ["arcane-focus"]], [["Scholar's pack"], ["Explorer's pack"]], [["Spellbook"]]]};
export const STARTING_WEALTH = {"artificer": ["5d4", 10], "barbarian": ["2d4", 10], "bard": ["5d4", 10], "cleric": ["5d4", 10], "druid": ["2d4", 10], "fighter": ["5d4", 10], "monk": ["5d4", 1], "paladin": ["5d4", 10], "ranger": ["5d4", 10], "rogue": ["4d4", 10], "sorcerer": ["3d4", 10], "warlock": ["4d4", 10], "wizard": ["4d4", 10]};
export const OLD_NAMES = {"clothes, common": "Common clothes", "clothes, costume": "Costume clothes", "clothes, fine": "Fine clothes", "clothes, traveler's": "Traveler's clothes", "bottle, glass": "Glass bottle", "case, crossbow bolt": "Crossbow bolt case", "case, map or scroll": "Map or scroll case", "hammer, sledge": "Sledgehammer", "lantern, bullseye": "Bullseye lantern", "lantern, hooded": "Hooded lantern", "mirror, steel": "Steel mirror", "pick, miner's": "Miner's pick", "pot, iron": "Iron pot", "ram, portable": "Portable ram", "rope, hempen (50 feet)": "Hempen rope (50 feet)", "rope, silk (50 feet)": "Silk rope (50 feet)", "scale, merchant's": "Merchant's scale", "spikes, iron (10)": "Iron spikes (10)", "tent, two-person": "Two-person tent", "poison, basic (vial)": "Basic poison (vial)", "ball bearings (bag of 1,000)": "Ball bearings (bag of 1000)"};
export const ALIASES = {"clothes, common": "Common clothes", "clothes, costume": "Costume clothes", "clothes, fine": "Fine clothes", "clothes, traveler's": "Traveler's clothes", "bottle, glass": "Glass bottle", "case, crossbow bolt": "Crossbow bolt case", "case, map or scroll": "Map or scroll case", "hammer, sledge": "Sledgehammer", "lantern, bullseye": "Bullseye lantern", "lantern, hooded": "Hooded lantern", "mirror, steel": "Steel mirror", "pick, miner's": "Miner's pick", "pot, iron": "Iron pot", "ram, portable": "Portable ram", "rope, hempen (50 feet)": "Hempen rope (50 feet)", "rope, silk (50 feet)": "Silk rope (50 feet)", "scale, merchant's": "Merchant's scale", "spikes, iron (10)": "Iron spikes (10)", "tent, two-person": "Two-person tent", "poison, basic (vial)": "Basic poison (vial)", "ball bearings (bag of 1,000)": "Ball bearings (bag of 1000)", "leather armor": "Leather", "studded leather armor": "Studded leather", "padded armor": "Padded", "hide armor": "Hide", "plate armor": "Plate", "splint armor": "Splint", "wooden shield": "Shield", "bolts": "Crossbow bolt", "bolt": "Crossbow bolt", "crossbow bolts": "Crossbow bolt", "arrows": "Arrow", "darts": "Dart", "javelins": "Javelin", "daggers": "Dagger", "handaxes": "Handaxe", "shortswords": "Shortsword", "sling bullets": "Sling bullet", "set of common clothes": "Common clothes", "common clothes": "Common clothes", "set of fine clothes": "Fine clothes", "fine clothes": "Fine clothes", "set of traveler's clothes": "Traveler's clothes", "traveler's clothes": "Traveler's clothes", "costume": "Costume clothes", "costume clothes": "Costume clothes", "pouch": "Pouch", "belt pouch": "Pouch", "spellbook": "Spellbook", "holy symbol": "holy-symbol", "arcane focus": "arcane-focus", "druidic focus": "druidic-focus", "musical instrument": "instrument", "rations": "Rations (1 day)", "torches": "Torch", "candles": "Candle", "hempen rope": "Hempen rope (50 feet)", "50 feet of hempen rope": "Hempen rope (50 feet)", "bottle of black ink": "Ink (1-ounce bottle)", "bottle of ink": "Ink (1-ounce bottle)", "quill": "Ink pen", "ink pen": "Ink pen", "crowbar": "Crowbar", "iron pot": "Iron pot", "shovel": "Shovel", "tinderbox": "Tinderbox", "waterskin": "Waterskin", "hunting trap": "Hunting trap", "fishing tackle": "Fishing tackle", "healer's kit": "Healer's kit", "book": "Book", "prayer book": "Book", "set of artisan's tools": "artisan-tools", "artisan's tools": "artisan-tools", "gaming set": "gaming-set", "set of dice": "Dice set", "deck of cards": "Playing card set", "dice": "Dice set", "thieves' tools": "Thieves' tools", "thieves’ tools": "Thieves' tools", "trinket": "Trinket", "quiver": "Quiver", "bedroll": "Bedroll", "blanket": "Blanket", "mess kit": "Mess kit", "torch": "Torch", "rope": "Hempen rope (50 feet)", "silk rope": "Silk rope (50 feet)", "lantern": "Hooded lantern", "hooded lantern": "Hooded lantern", "bullseye lantern": "Bullseye lantern", "potion of healing": "Potion of healing", "healing potion": "Potion of healing", "potions of healing": "Potion of healing", "flask of oil": "Oil (flask)", "oil": "Oil (flask)", "piton": "Piton", "pitons": "Piton", "chalk": "Chalk", "sack": "Sack", "small knife": "Small knife", "staff": "Arcane focus (staff)", "wand": "Arcane focus (wand)", "orb": "Arcane focus (orb)", "crystal": "Arcane focus (crystal)", "rod": "Arcane focus (rod)", "amulet": "Holy symbol (amulet)", "emblem": "Holy symbol (emblem)", "reliquary": "Holy symbol (reliquary)", "totem": "Druidic focus (totem)", "sprig of mistletoe": "Druidic focus (sprig of mistletoe)", "ration": "Rations (1 day)", "days of rations": "Rations (1 day)", "trail rations": "Rations (1 day)"};
export const NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "twenty": 20};
export const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
export const WEAPON_FLAGS = ["ammunition", "finesse", "heavy", "light", "loading", "reach", "special", "thrown", "two-handed", "versatile"];
export const BOW_FORMS = ["Shortbow", "Longbow", "Light crossbow", "Heavy crossbow"];
export const EFFECT_TYPES = ["ac", "save", "score_set", "score_inc", "attack", "damage", "spell_attack", "spell_dc", "skill", "init", "speed", "hp", "extra_damage", "resist", "note"];
export const COIN_ORDER = ["pp", "gp", "ep", "sp", "cp"];
export const KIND_ORDER = {"armor": 0, "shield": 1, "weapon": 2, "magic": 3, "ammo": 4, "focus": 5, "tool": 6, "instrument": 7, "consumable": 8, "treasure": 9, "gear": 10, "pack": 11};
export const BOND_LABEL = {"pact": "pact weapon", "hex": "hex weapon", "bond": "bonded", "kensei": "kensei weapon"};
export const INSTRUMENTS = ["Bagpipes", "Drum", "Dulcimer", "Flute", "Horn", "Lute", "Lyre", "Pan flute", "Shawm", "Viol"];
export const FOCUS_BY_CLASS = {"wizard": ["Arcane focus (crystal)", "Arcane focus (orb)", "Arcane focus (rod)", "Arcane focus (staff)", "Arcane focus (wand)", "Spellbook"], "sorcerer": ["Arcane focus (crystal)", "Arcane focus (orb)", "Arcane focus (rod)", "Arcane focus (staff)", "Arcane focus (wand)"], "warlock": ["Arcane focus (crystal)", "Arcane focus (orb)", "Arcane focus (rod)", "Arcane focus (staff)", "Arcane focus (wand)"], "cleric": ["Holy symbol (amulet)", "Holy symbol (emblem)", "Holy symbol (reliquary)"], "paladin": ["Holy symbol (amulet)", "Holy symbol (emblem)", "Holy symbol (reliquary)"], "druid": ["Druidic focus (sprig of mistletoe)", "Druidic focus (totem)", "Druidic focus (wooden staff)", "Druidic focus (yew wand)"], "bard": ["Bagpipes", "Drum", "Dulcimer", "Flute", "Horn", "Lute", "Lyre", "Pan flute", "Shawm", "Viol"], "artificer": ["Thieves' tools", "Alchemist's supplies", "Brewer's supplies", "Calligrapher's supplies", "Carpenter's tools", "Cartographer's tools", "Cobbler's tools", "Cook's utensils", "Glassblower's tools", "Jeweler's tools", "Leatherworker's tools", "Mason's tools", "Painter's supplies", "Potter's tools", "Smith's tools", "Tinker's tools", "Weaver's tools", "Woodcarver's tools"]};
export const KIND_FOR_TYPE = {"potion": "consumable", "scroll": "consumable"};
export const DEFAULT_FORM = [["sword", "Longsword"], ["axe", "Battleaxe"], ["hammer", "Warhammer"], ["bow", "Longbow"], ["crossbow", "Light crossbow"], ["mace", "Mace"], ["dagger", "Dagger"], ["spear", "Spear"], ["arrow", "Arrow"], ["plate", "Plate"], ["light", "Leather"], ["medium", "Half plate"], ["heavy", "Plate"], ["chain", "Chain mail"], ["scale", "Scale mail"]];

// choice tokens: key -> [label, test(name, weapon data)]
export const CHOICES = {
  simple: ['any simple weapon', (n, d) => d[0] === 'simple' && n !== 'Unarmed strike'],
  'simple-melee': ['any simple melee weapon', (n, d) => d[0] === 'simple' && !d[1] && n !== 'Unarmed strike'],
  martial: ['any martial weapon', (n, d) => d[0] === 'martial'],
  'martial-melee': ['any martial melee weapon', (n, d) => d[0] === 'martial' && !d[1]],
};

const has = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
const orStr = (v) => (T(v) ? v : '');
const ARMOR_SUFFIXED = ['Leather', 'Studded leather', 'Padded', 'Hide', 'Plate', 'Splint'];

function allNames() {
  const names = {};
  for (const n of [...Object.keys(WEAPONS), ...Object.keys(ARMOR), ...Object.keys(GEAR), ...Object.keys(PACKS), ...Object.keys(EXTRA)]) {
    names[n.toLowerCase()] = n;
  }
  names.shield = 'Shield';
  return names;
}

function singular(word) {
  if (word.endsWith('ves')) return word.slice(0, -3) + 'f';
  if (word.endsWith('es') && ['ch', 'sh', 'x'].some((e) => word.slice(0, -2).endsWith(e))) return word.slice(0, -2);
  return word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** Catalog name for free text ('leather armor', 'two daggers' -> 'Dagger'), or null. */
export function lookup(name) {
  const low = name.replaceAll('’', "'").toLowerCase().trim().replace(/\s+/g, ' ');
  if (has(ALIASES, low)) return ALIASES[low];
  const names = allNames();
  if (has(names, low)) return names[low];
  const words = low ? low.split(' ') : [];
  const sing = words.map((w, i) => (i === words.length - 1 ? singular(w) : w)).join(' ');
  if (has(ALIASES, sing)) return ALIASES[sing];
  if (has(names, sing)) return names[sing];
  return null;
}

const stripDots = (s) => s.replace(/^\.+|\.+$/g, '');

/** 'two daggers' -> ['Dagger*2']; 'a pouch containing 15 gp' -> ['Pouch', 'coins:gp:15']; unknown -> 'custom:...'. */
export function parsePhrase(phrase) {
  const tokens = [];
  let text = stripDots((phrase || '').replaceAll('’', "'").replace(/\([^)]*\)/g, '').trim()).trim();
  if (!text) return tokens;
  for (const m of text.matchAll(/(\d+)\s*(pp|gp|ep|sp|cp)\b/gi)) tokens.push(`coins:${m[2].toLowerCase()}:${m[1]}`);
  text = text.replace(/(?:containing|with)?\s*\d+\s*(pp|gp|ep|sp|cp)\b/gi, '').trim();
  if (!text) return tokens;
  let low = text.toLowerCase();
  low = low.replace(/\s*if proficient\s*/g, '').trim();
  low = low.replace(/^your choice of\s+/, '');
  let m = low.match(/\b(hempen|silk) rope\b/);
  if (m) return [...tokens, `${capitalize(m[1])} rope (50 feet)`];
  m = low.match(/^(?:a\s+)?quiver of (\d+) arrows$/);
  if (m) return [...tokens, 'Quiver', `Arrow*${m[1]}`];
  for (const [key, [label]] of Object.entries(CHOICES)) {
    const words = label.replaceAll('any ', '');
    m = low.match(new RegExp(`^(?:any|a|an|one)?\\s*(?:(two|three)\\s+)?(?:other\\s+)?${words}s?(?: of your choice)?$`));
    if (m) return [...tokens, ...Array(get(NUM, m[1] || 'one', 1)).fill(key)];
  }
  m = low.match(/^(?:any\s+)?(two|three)\s+(simple|martial)\s+(melee\s+)?weapons?(?: of your choice)?$/);
  if (m) {
    const key = m[2] + (m[3] ? '-melee' : '');
    return [...tokens, ...Array(NUM[m[1]]).fill(key)];
  }
  m = low.match(/^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|twenty|\d+)\s+(.*)$/);
  let qty = 1, rest = low;
  if (m) {
    qty = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : NUM[m[1]];
    rest = m[2];
  }
  rest = rest.replace(/^(?:sticks|blocks|pieces|sheets|days|flasks|vials|bottles|sets) of\s+/, '');
  rest = rest.replace(/^(?:any other|other|another)\s+/, '');
  const name = lookup(rest);
  if (name) return [...tokens, qty === 1 ? name : `${name}*${qty}`];
  const custom = rest.slice(0, 1).toUpperCase() + rest.slice(1);
  return [...tokens, `custom:${custom}` + (qty > 1 ? `*${qty}` : '')];
}

export function splitItems(text) {
  text = (text || '').replace(/\([^)]*\)/g, '');
  return text.split(/,\s*(?:and\s+)?|\s+and\s+(?![^,]*\bor\b)/).map((p) => p.trim()).filter(Boolean);
}

/** '(a) a quarterstaff or (b) a dagger' -> [['Quarterstaff'], ['Dagger']]. */
export function parseLine(line) {
  line = (line || '').replace(/^\s*[-•]\s*/, '').trim().replace(/\.+$/, '');
  const pieces = line.split(/\s*(?:,\s*)?(?:or\s+)?\(([a-e])\)\s*/);
  const options = pieces.length > 1 ? pieces.filter((p, i) => i % 2 === 0 && i > 0) : [line];
  const out = [];
  for (const opt of options) {
    const tokens = [];
    for (const phrase of splitItems(opt)) tokens.push(...parsePhrase(phrase));
    if (tokens.length) out.push(tokens);
  }
  return out;
}

/** A random 10-character hex id, like uuid4().hex[:10]. */
export function newId() {
  const c = globalThis.crypto;
  const bytes = new Uint8Array(5);
  if (c && c.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 5; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** [weight of one, whether Python holds it as a float] */
function unitWeightTyped(name) {
  if (has(GEAR, name)) return [GEAR[name].weight / GEAR[name].per, true];
  let w = 0;
  if (has(WEAPON_COST, name)) w = WEAPON_COST[name][1];
  else if (has(ARMOR_COST, name)) w = ARMOR_COST[name][1];
  else if (has(EXTRA, name)) w = EXTRA[name];
  return [w, !Number.isInteger(w)];
}
const packWeight = (contents) => {
  const parts = contents.map(([n, q]) => { const [w, f] = unitWeightTyped(n); return [w * q, f]; });
  return round(fsum(parts.map((p) => p[0]), (_, i) => parts[i][1]), 2);
};

/** An inventory item for a catalog name (or a custom name). */
export function makeItem(name, qty = 1, src = '', note = '') {
  const item = { id: newId(), name, qty, weight: 0, cost_cp: 0, kind: 'gear', src };
  if (has(WEAPONS, name)) {
    const [cost, weight] = get(WEAPON_COST, name, [0, 0]);
    Object.assign(item, { kind: 'weapon', base: name, weight, cost_cp: cost, equipped: true, bonus: 0 });
  } else if (name === 'Shield') {
    const [cost, weight] = ARMOR_COST.Shield;
    Object.assign(item, { kind: 'shield', base: 'Shield', weight, cost_cp: cost, equipped: false, bonus: 0 });
  } else if (has(ARMOR, name)) {
    const [cost, weight] = get(ARMOR_COST, name, [0, 0]);
    Object.assign(item, { kind: 'armor', base: name, name: ARMOR_SUFFIXED.includes(name) ? `${name} armor` : name,
      weight, cost_cp: cost, equipped: false, bonus: 0 });
  } else if (has(PACKS, name)) {
    const [cost, contents] = PACKS[name];
    Object.assign(item, { kind: 'pack', weight: packWeight(contents), cost_cp: cost, contents: contents.map(([n, q]) => [n, q]) });
  } else if (has(GEAR, name)) {
    const g = GEAR[name];
    Object.assign(item, { kind: g.kind, weight: round(g.weight / g.per, 3), cost_cp: round(g.cost_cp / g.per, 2) });
  } else if (has(EXTRA, name)) {
    item.weight = EXTRA[name];
  }
  if (T(note)) item.notes = note;
  return item;
}

export function unpack(packItem) {
  return list(or(get(packItem, 'contents'), [])).map(([n, q]) => makeItem(n, q, get(packItem, 'src', '')));
}

/** Tokens of one option -> entries the app shows: items, choices to make, coins. */
export function resolveOption(tokens) {
  const out = [];
  for (const t of tokens) {
    let name = t, q = '1';
    if (t.includes('*')) {
      const at = t.lastIndexOf('*');
      [name, q] = [t.slice(0, at), t.slice(at + 1)];
    }
    const qty = int(q);
    if (name.startsWith('coins:')) {
      const parts = name.split(':');
      if (parts.length !== 3) throw new Error(`bad coin token ${name}`);
      out.push({ coins: { [parts[1]]: int(parts[2]) } });
    } else if (has(CHOICES, name)) {
      const [label, test] = CHOICES[name];
      out.push({ choose: name, label, qty, options: Object.entries(WEAPONS).filter(([n, d]) => test(n, d)).map(([n]) => n) });
    } else if (has(FOCUS_CHOICES, name)) {
      const [label, opts] = FOCUS_CHOICES[name];
      out.push({ choose: name, label, qty, options: [...opts] });
    } else if (name.startsWith('custom:')) {
      out.push({ item: makeItem(name.slice(7), qty) });
    } else {
      out.push({ item: makeItem(name, qty) });
    }
  }
  return out;
}

/** A background's equipment line -> entries (items, choices and coins). */
export function backgroundItems(equipmentText) {
  const tokens = [];
  for (const phrase of splitItems((equipmentText || '').replaceAll('’', "'"))) {
    if (/\bor\b/.test(phrase) && !/\d+\s*(gp|sp|cp)/.test(phrase)) {
      tokens.push('custom:' + capitalize(phrase.trim().replace(/^(a|an)\s+/i, '')));
    } else {
      tokens.push(...parsePhrase(phrase));
    }
  }
  return resolveOption(tokens);
}

/** Free text like "An explorer's pack, a holy symbol and 10 gp" -> [items, coins].
    Focus choices take their first option; open weapon choices ("any simple weapon") are left out. */
export function itemsFromText(text) {
  const items = [], coins = {};
  for (const e of backgroundItems(text)) {
    if ('coins' in e) {
      for (const [k, v] of Object.entries(e.coins)) coins[k] = get(coins, k, 0) + v;
    } else if ('choose' in e) {
      if (['arcane-focus', 'holy-symbol', 'druidic-focus'].includes(e.choose) && e.options.length) {
        items.push(makeItem(e.options[0], e.qty));
      } else if (has(FOCUS_CHOICES, e.choose)) {
        const label = e.label.replace(/^(a|an)\s+/, '');
        items.push(makeItem(label.slice(0, 1).toUpperCase() + label.slice(1), e.qty));
      }
    } else {
      items.push(e.item);
    }
  }
  return [items, coins];
}

function splitToken(t) {
  const at = t.lastIndexOf('*');
  if (at >= 0 && /^\d+$/.test(t.slice(at + 1))) return [t.slice(0, at), parseInt(t.slice(at + 1), 10)];
  return [t, 1];
}

export function displayName(name) {
  return ARMOR_SUFFIXED.includes(name) ? `${name} armor` : name;
}

/** ['Handaxe*2'] -> 'Handaxe ×2'; ['martial', 'Shield'] -> 'any martial weapon, Shield'. */
export function optionLabel(tokens) {
  const parts = [];
  for (const t of tokens) {
    const [name, qty] = splitToken(t);
    if (name.startsWith('coins:')) {
      const bits = name.split(':');
      if (bits.length !== 3) throw new Error(`bad coin token ${name}`);
      parts.push(`${bits[2]} ${bits[1]}`);
      continue;
    }
    let label;
    if (has(CHOICES, name)) label = CHOICES[name][0];
    else if (has(FOCUS_CHOICES, name)) label = FOCUS_CHOICES[name][0];
    else if (name.startsWith('custom:')) label = name.slice(7);
    else label = displayName(name);
    parts.push(label + (qty > 1 ? ` ×${qty}` : ''));
  }
  return parts.join(', ');
}

/** Lines of options for a class: built-in for the Player's Handbook classes (and the artificer), parsed text otherwise. */
export function startingEquipment(classSlug, classLines = null) {
  let raw, texts;
  if (has(STARTING_EQUIPMENT, classSlug)) {
    [raw, texts] = [STARTING_EQUIPMENT[classSlug], null];
  } else {
    raw = list(or(classLines, [])).map((line) => parseLine(line));
    texts = [...list(or(classLines, []))];
  }
  const lines = [];
  raw.forEach((options, i) => {
    if (!options.length) return;
    const text = T(texts) ? texts[i] : (options.length > 1
      ? options.map((o, n) => `(${String.fromCharCode(97 + n)}) ${optionLabel(o)}`).join(' or ')
      : optionLabel(options[0]));
    lines.push({ text, options: options.map((o) => resolveOption(o)), labels: options.map((o) => optionLabel(o)) });
  });
  return lines;
}

function customWeapon(item) {
  const w = get(item, 'weapon');
  return isDict(w) && orStr(get(w, 'damage')).trim() ? w : null;
}

function customArmor(item) {
  const a = get(item, 'armor');
  return isDict(a) && ['light', 'medium', 'heavy', 'shield'].includes(get(a, 'category')) ? a : null;
}

/** What an item does in the rules: 'armor', 'shield', 'weapon' or ''. */
export function role(item) {
  if (customWeapon(item)) return 'weapon';
  const a = customArmor(item);
  if (a) return a.category === 'shield' ? 'shield' : 'armor';
  const base = get(item, 'base');
  if (has(WEAPONS, base)) return 'weapon';
  if (base === 'Shield') return 'shield';
  if (has(ARMOR, base)) return 'armor';
  return '';
}

/** [category, ranged, damage, damage type, properties] from the item's own stats or the weapon it works as. */
export function weaponStats(item) {
  const w = customWeapon(item);
  if (!w) {
    const base = get(item, 'base');
    return has(WEAPONS, base) ? WEAPONS[base] : null;
  }
  const rng = orStr(get(w, 'range')).trim();
  const props = [];
  for (const p of list(or(get(w, 'properties'), []))) {
    if (p === 'versatile' && orStr(get(w, 'versatile')).trim()) props.push(`versatile (${w.versatile.trim()})`);
    else if ((p === 'ammunition' || p === 'thrown') && rng) props.push(`${p} (${rng})`);
    else if (WEAPON_FLAGS.includes(p)) props.push(p);
  }
  if (T(get(w, 'ranged')) && rng && !props.some((x) => x.startsWith('ammunition') || x.startsWith('thrown'))) {
    props.push(`range (${rng})`);
  }
  return [get(w, 'category') === 'martial' ? 'martial' : 'simple', T(get(w, 'ranged')), w.damage.trim(),
    orStr(get(w, 'type')).trim(), props];
}

/** [category, base AC, max Dex, Strength needed, Stealth disadvantage] for worn armor. */
export function armorStats(item) {
  const a = customArmor(item);
  if (a && a.category !== 'shield') {
    let maxdex = get(a, 'maxdex');
    maxdex = maxdex === null || maxdex === '' || maxdex === 'full' ? null : int(toFloat(maxdex));
    if (a.category === 'heavy') maxdex = 0;
    return [a.category, int(toFloat(get(a, 'ac'), 10)), maxdex, int(toFloat(get(a, 'str'))), T(get(a, 'stealth'))];
  }
  const base = get(item, 'base');
  return has(ARMOR, base) ? ARMOR[base] : null;
}

export function shieldAc(item) {
  const a = customArmor(item);
  return a && a.category === 'shield' ? int(toFloat(get(a, 'ac'), 2)) : 2;
}

/** An item that needs attunement only works for an attuned character. */
export function magicActive(item) {
  const m = or(get(item, 'magic'), {});
  return !T(get(m, 'attune')) || T(get(m, 'attuned'));
}

export function inUse(item) {
  return T(get(item, 'equipped')) && get(item, 'carried', true) !== false && magicActive(item);
}

export function attunementLimit(levelOf) {
  const art = get(levelOf, 'artificer', 0);
  return art >= 18 ? 6 : art >= 14 ? 5 : art >= 10 ? 4 : 3;
}

const SUMMED = ['ac', 'attack', 'damage', 'spell_attack', 'spell_dc', 'init', 'speed', 'hp'];

/** Add up the effects of magic items that are in use (and attuned, when they need it). */
export function itemEffects(inventory) {
  const fx = { ac: 0, save: {}, score_set: {}, score_inc: [], attack: 0, damage: 0, spell_attack: 0, spell_dc: 0,
    skill: {}, init: 0, speed: 0, hp: 0, riders: [], extra: {}, resist: [], notes: [], sources: {} };
  for (const it of inventory) {
    if (!inUse(it)) continue;
    list(or(get(it, 'effects'), [])).forEach((e, i) => {
      if (!isDict(e)) return;
      const t = get(e, 'type'), v = int(toFloat(get(e, 'value')));
      const src = or(get(it, 'name'), 'Item');
      if (SUMMED.includes(t)) {
        fx[t] += v;
        if (v) setdefault(fx.sources, t, []).push(`${src} ${v >= 0 ? '+' : ''}${v}`);
      } else if (t === 'save') {
        const key = ABILITIES.includes(get(e, 'ability')) ? e.ability : 'all';
        fx.save[key] = get(fx.save, key, 0) + v;
      } else if (t === 'score_set' && T(get(e, 'ability'))) {
        fx.score_set[e.ability] = max2(get(fx.score_set, e.ability, 0), v);
      } else if (t === 'score_inc' && T(get(e, 'ability'))) {
        fx.score_inc.push([e.ability, v, int(toFloat(get(e, 'cap'), 20)) || 20]);
      } else if (t === 'skill' && T(get(e, 'skill'))) {
        fx.skill[e.skill] = get(fx.skill, e.skill, 0) + v;
      } else if (t === 'extra_damage' && orStr(get(e, 'dice')).trim()) {
        const dice = e.dice.trim(), dtype = orStr(get(e, 'dtype')).trim();
        const weapon = role(it) === 'weapon';
        if (T(get(e, 'switch'))) {
          fx.riders.push({ id: `item-${pyStr(get(it, 'id'))}-${i}`, name: `${src} (${dice}${dtype ? ' ' + dtype : ''})`,
            dice, flat: 0, type: dtype, once: false, applies: weapon ? `item:${pyStr(get(it, 'id'))}` : 'weapon' });
        } else {
          setdefault(fx.extra, weapon ? jsonKey(get(it, 'id')) : '*', []).push({ dice, type: dtype, name: src });
        }
      } else if (t === 'resist' && orStr(get(e, 'dtype')).trim()) {
        fx.resist.push(e.dtype.trim());
      } else if (t === 'note' && orStr(get(e, 'text')).trim()) {
        fx.notes.push({ name: src, text: e.text.trim() });
      }
    });
  }
  return fx;
}

/** Add items, stacking ones that are the same thing (torches, arrows, daggers). */
export function mergeItems(inventory, newItems) {
  const bonus = (x) => int(toFloat(get(x, 'bonus')));
  for (const it of newItems) {
    let same = null;
    if (!['armor', 'shield', 'pack'].includes(get(it, 'kind')) && !T(get(it, 'notes'))) {
      same = inventory.find((x) => get(x, 'name') === get(it, 'name') && get(x, 'kind') === get(it, 'kind')
        && bonus(x) === bonus(it) && !T(get(x, 'notes')) && get(x, 'carried', true) !== false) ?? null;
    }
    if (T(same)) same.qty = int(toFloat(get(same, 'qty'), 1)) + int(toFloat(get(it, 'qty'), 1));
    else inventory.push(it);
  }
  return inventory;
}

/** Give an older character an inventory built from its armor, shield and weapon picks. */
export function ensureInventory(char) {
  if (Array.isArray(get(char, 'inventory'))) return char;
  const items = [];
  const armor = or(get(char, 'armor'), '');
  if (has(ARMOR, armor)) {
    const it = makeItem(armor);
    it.equipped = true;
    items.push(it);
  }
  if (T(get(char, 'shield'))) {
    const it = makeItem('Shield');
    it.equipped = true;
    items.push(it);
  }
  for (const w of list(or(get(char, 'weapons'), []))) {
    const name = typeof w === 'string' ? w : get(w, 'name', '');
    if (name === 'Unarmed strike') {
      setdefault(char, 'unarmed', true);
    } else if (has(WEAPONS, name)) {
      const it = makeItem(name);
      if (isDict(w) && T(get(w, 'bonus'))) it.bonus = int(w.bonus);
      items.push(it);
    }
  }
  char.inventory = items;
  return char;
}

/** Armor being worn, shields held and weapons at the ready, from the inventory (or older fields). */
export function gearInUse(char) {
  let inv = get(char, 'inventory');
  if (!Array.isArray(inv)) {
    inv = ensureInventory({ armor: get(char, 'armor'), shield: get(char, 'shield'), weapons: get(char, 'weapons') }).inventory;
  }
  inv = inv.filter(isDict);
  const worn = (r) => inv.filter((i) => role(i) === r && T(get(i, 'equipped')));
  return { inventory: inv, armor: worn('armor'), shields: worn('shield'), weapons: worn('weapon') };
}

export function coinsText(coins) {
  coins = or(coins, {});
  const n = (k) => int(toFloat(get(coins, k)));
  return COIN_ORDER.filter((k) => n(k)).map((k) => `${n(k)} ${k}`).join(', ');
}

export function totalWeight(inventory, coins = null) {
  const w = fsum(inventory.filter((i) => get(i, 'carried', true) !== false)
    .map((i) => toFloat(get(i, 'weight')) * max2(0, toFloat(get(i, 'qty'), 1))));
  const n = COIN_ORDER.reduce((t, k) => t + Math.max(0, int(toFloat(get(or(coins, {}), k)))), 0);
  return round(w + n / 50, 1);
}

export function sortKey(item) {
  const r = role(item);
  return [get(KIND_ORDER, r || get(item, 'kind') || 'gear', 10), orStr(get(item, 'name')).toLowerCase()];
}

/** One line per item for the printed sheet. */
export function inventoryLines(inventory) {
  const keyed = inventory.map((i) => [sortKey(i), i]);
  keyed.sort(([a], [b]) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const lines = [];
  for (const [, i] of keyed) {
    const name = orStr(get(i, 'name')).trim();
    if (!name) continue;
    const bonus = int(toFloat(get(i, 'bonus')));
    const qty = int(toFloat(get(i, 'qty'), 1));
    const text = name + (bonus > 0 ? ` +${bonus}` : bonus < 0 ? ` ${bonus}` : '') + (qty !== 1 ? ` ×${qty}` : '');
    const tags = [];
    const r = role(i);
    if (r === 'armor' && T(get(i, 'equipped'))) tags.push('worn');
    if (r === 'shield' && T(get(i, 'equipped'))) tags.push('held');
    if (r === 'weapon' && T(get(i, 'bond'))) tags.push(get(BOND_LABEL, i.bond, 'bonded'));
    const m = or(get(i, 'magic'), {});
    if (T(get(m, 'attune'))) tags.push(T(get(m, 'attuned')) ? 'attuned' : 'needs attunement');
    const ch = or(get(i, 'charges'), {});
    const chMax = int(toFloat(get(ch, 'max')));
    if (chMax) tags.push(`${Math.max(0, chMax - int(toFloat(get(ch, 'used'))))}/${chMax} charges`);
    if (int(toFloat(get(i, 'value_cp')))) tags.push(`worth ${money(toFloat(get(i, 'value_cp')))}${qty > 1 ? ' each' : ''}`);
    if (get(i, 'carried', true) === false) tags.push('not carried');
    if (orStr(get(i, 'notes')).trim()) tags.push(i.notes.trim());
    lines.push(text + (tags.length ? ` (${tags.join('; ')})` : ''));
  }
  return lines;
}

export function money(cp) {
  cp = toFloat(cp);
  if (cp >= 100) return `${fmtG(cp / 100)} gp`;
  if (cp >= 10 && cp % 10 === 0) return `${fmtG(cp / 10)} sp`;
  return `${fmtG(cp)} cp`;
}

/** What the treasure is worth, in copper. */
export function treasureValue(inventory) {
  return fsum(inventory.filter((i) => get(i, 'kind') === 'treasure')
    .map((i) => toFloat(get(i, 'value_cp')) * max2(0, toFloat(get(i, 'qty'), 1))));
}

/** Catalog tools and instruments named in proficiency text. */
export function toolProfs(text) {
  const t = (text || '').toLowerCase().replaceAll('’', "'");
  const out = new Set(Object.entries(GEAR).filter(([n, g]) => ['tool', 'instrument'].includes(g.kind) && t.includes(n.toLowerCase()))
    .map(([n]) => n));
  if (t.includes('artisan')) ARTISAN_TOOLS.forEach((x) => out.add(x));
  if (t.includes('musical instrument')) INSTRUMENTS.forEach((x) => out.add(x));
  if (t.includes('gaming set')) ['Dice set', 'Playing card set'].forEach((x) => out.add(x));
  if (t.includes('thieves')) out.add("Thieves' tools");
  return sorted(out);
}

export function usableFocus(classSlugs, caster = false) {
  const out = new Set();
  for (const slug of classSlugs) get(FOCUS_BY_CLASS, slug, []).forEach((x) => out.add(x));
  if (T(caster)) out.add('Component pouch');
  return sorted(out);
}

/** Everything the shop list offers, with cost and weight. */
export function catalog() {
  const out = [];
  for (const [n, [cost, w]] of Object.entries(WEAPON_COST)) {
    if (n === 'Unarmed strike') continue;
    const d = WEAPONS[n];
    out.push({ name: n, kind: 'weapon', group: `${d[0]} ${d[1] ? 'ranged' : 'melee'}`, cost_cp: cost, weight: w,
      info: `${d[2]} ${d[3]}` + (d[4].length ? `; ${d[4].join(', ')}` : '') });
  }
  for (const [n, [cost, w]] of Object.entries(ARMOR_COST)) {
    if (n === 'Shield') {
      out.push({ name: n, kind: 'shield', group: 'shield', cost_cp: cost, weight: w, info: '+2 AC' });
      continue;
    }
    const [cat, base, maxdex, strreq, stealth] = ARMOR[n];
    let info = `AC ${base}` + (maxdex === 0 ? '' : maxdex === null ? ' + Dex' : ` + Dex (max ${maxdex})`);
    info += (strreq ? `; Str ${strreq}` : '') + (stealth ? '; Stealth disadvantage' : '');
    out.push({ name: displayName(n), base: n, kind: 'armor', group: cat, cost_cp: cost, weight: w, info });
  }
  for (const [n, g] of Object.entries(GEAR)) {
    out.push({ name: n, kind: g.kind, group: g.kind, cost_cp: g.cost_cp, weight: g.weight, per: g.per,
      info: g.per > 1 ? `bundle of ${g.per}` : '' });
  }
  for (const [n, [cost, contents]] of Object.entries(PACKS)) {
    out.push({ name: n, kind: 'pack', group: 'pack', cost_cp: cost, weight: packWeight(contents),
      info: contents.map(([c, q]) => `${c}${q > 1 ? ` ×${q}` : ''}`).join(', ') });
  }
  return out;
}

// ---------------------------------------------------------- magic items (wikiparse.item_effects_from_text)
export const ABILITY_WORDS = 'Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma';
export const DAMAGE_WORDS = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const SCORE_SET_RE = new RegExp(`your (${ABILITY_WORDS}) score (?:is|becomes|changes to) (\\d+)`, 'gi');
const SCORE_INC_RE = new RegExp(`your (${ABILITY_WORDS}) score increases by (\\d+)(?:,? to a maximum of (\\d+))?(,? as does your maximum)?`, 'gi');
const RESIST_RE = new RegExp(`you have resistance to (${DAMAGE_WORDS}) damage`, 'gi');
const EXTRA_RE = new RegExp(`extra (\\d+d\\d+) (${DAMAGE_WORDS})? ?damage`, 'i');
const CONDITIONAL_RE = /\bwhile\b|\bif the target\b|\bagainst\b|command word|ablaze|once per turn|expend|\bhit an? (?!attack)\w+/i;

/** re.split(r"(?<=[.!?])\s+", t) without lookbehind (older Safari doesn't have it). */
function sentences(t) {
  const out = [];
  let start = 0;
  for (const m of t.matchAll(/[.!?]\s+/g)) {
    out.push(t.slice(start, m.index + 1));
    start = m.index + m[0].length;
  }
  out.push(t.slice(start));
  return out;
}

/** Effects we can read reliably from a magic item's description. */
export function itemEffectsFromText(body, info) {
  const fx = [];
  const t = (body || '').replace(/\s+/g, ' ');
  const kind = get(info, 'item_type', '');
  const worn = !['potion', 'scroll'].includes(kind);
  let variant = 0;
  if (T(get(info, 'variants'))) {
    if (!Object.hasOwn(info.variants[0], 'bonus')) throw new Error("KeyError: 'bonus'");
    variant = info.variants[0].bonus;
  }
  if (worn) {
    let m = t.match(/\+(\d) bonus to AC and saving throws/i);
    if (m) {
      fx.push({ type: 'ac', value: parseInt(m[1], 10) }, { type: 'save', value: parseInt(m[1], 10), ability: 'all' });
    } else if (!['armor', 'shield'].includes(kind)) {
      m = t.match(/\+(\d) bonus to (?:your )?(?:Armor Class|AC)\b/i);
      if (m) fx.push({ type: 'ac', value: parseInt(m[1], 10) });
      m = t.match(/\+(\d) bonus to (?:all )?saving throws/i);
      if (m) fx.push({ type: 'save', value: parseInt(m[1], 10), ability: 'all' });
    }
    for (const x of t.matchAll(SCORE_SET_RE)) fx.push({ type: 'score_set', ability: x[1].slice(0, 3).toLowerCase(), value: parseInt(x[2], 10) });
    for (const x of t.matchAll(SCORE_INC_RE)) {
      if (x[4]) continue;
      fx.push({ type: 'score_inc', ability: x[1].slice(0, 3).toLowerCase(), value: parseInt(x[2], 10), cap: parseInt(x[3] || '20', 10) });
    }
    m = t.match(/spell save DC and spell attack bonus (?:each )?increase by (\d)/i);
    if (m) {
      fx.push({ type: 'spell_attack', value: parseInt(m[1], 10) }, { type: 'spell_dc', value: parseInt(m[1], 10) });
    } else {
      m = t.match(/\+(\d) bonus to spell attack rolls/i);
      if (m) fx.push({ type: 'spell_attack', value: parseInt(m[1], 10) });
      m = t.match(/\+(\d) bonus to (?:your )?spell save DCs?/i);
      if (m) fx.push({ type: 'spell_dc', value: parseInt(m[1], 10) });
      if (T(variant) && /bonus to spell attack rolls/i.test(t) && /determined by the [\w' ]+rarity/i.test(t)) {
        fx.push({ type: 'spell_attack', value: variant });
        if (/saving throw DCs? of your/i.test(t)) fx.push({ type: 'spell_dc', value: variant });
      }
    }
    m = t.match(/\+(\d) bonus to initiative/i);
    if (m) fx.push({ type: 'init', value: parseInt(m[1], 10) });
    m = t.match(/your (?:walking )?speed (?:increases|is increased) by (\d+) feet/i);
    if (m) fx.push({ type: 'speed', value: parseInt(m[1], 10) });
    for (const x of t.matchAll(RESIST_RE)) fx.push({ type: 'resist', dtype: x[1].toLowerCase() });
    if (/you have resistance to all damage/i.test(t)) fx.push({ type: 'resist', dtype: 'all damage' });
  }
  if (['weapon', 'ammunition', 'staff'].includes(kind)) {
    for (const sentence of sentences(t)) {
      const m = sentence.match(EXTRA_RE);
      if (!m) continue;
      fx.push({ type: 'extra_damage', dice: m[1], dtype: (m[2] || '').toLowerCase(), switch: CONDITIONAL_RE.test(sentence) });
    }
  }
  return fx;
}

/** An inventory item for a magic item in the library (the wiki's, a PDF's or your own). */
export function itemFromEntry(entry, variant = null) {
  const d = { ...or(get(entry, 'data'), {}) };
  const t = orStr(get(d, 'item_type')).toLowerCase();
  const variants = or(get(d, 'variants'), []);
  const vi = typeof variant === 'boolean' ? Number(variant) : variant;
  const chosen = Number.isInteger(vi) && vi >= 0 && vi < variants.length ? variants[vi] : (T(variants) ? variants[0] : null);
  let base = or(get(d, 'works_as'), '');
  let note = '';
  if (!T(base) && ['weapon', 'armor', 'ammunition'].includes(t)) {
    const detail = orStr(get(d, 'type_detail')).toLowerCase();
    const hit = DEFAULT_FORM.find(([word, form]) => detail.includes(word) && (t !== 'armor' ? has(WEAPONS, form) : has(ARMOR, form)));
    base = hit ? hit[1] : (t === 'armor' ? 'Chain mail' : t === 'ammunition' ? 'Arrow' : 'Longsword');
    note = `Uses ${displayName(base).toLowerCase()} stats; change that with Edit if yours is a different `
      + `${t === 'armor' ? 'armor' : 'weapon'}.`;
  }
  if (t === 'shield') base = 'Shield';
  const forms = {};
  for (const n of [...Object.keys(WEAPONS), ...Object.keys(ARMOR), 'Shield']) forms[n.toLowerCase()] = n;
  const lookupBase = get(forms, pyStr(base).toLowerCase(), '');
  let item;
  if (lookupBase) {
    item = makeItem(lookupBase);
  } else {
    item = { id: newId(), qty: 1, weight: 0, cost_cp: 0, kind: 'gear' };
    if (t === 'staff' && T(base)) item = makeItem('Quarterstaff');
  }
  item.name = or(get(entry, 'name'), get(item, 'name'), 'Magic item');
  item.src = 'library';
  if (!role(item)) item.kind = get(KIND_FOR_TYPE, t, t === 'ammunition' ? 'ammo' : 'magic');
  const text = or(get(d, 'text'), get(d, 'description'), '');
  const rarity = or(get(or(chosen, {}), 'rarity'), get(d, 'rarity'), '');
  item.magic = { rarity: rarity !== 'varies' ? rarity : '', attune: T(get(d, 'attunement')), attuned: false,
    desc: (T(get(d, 'attune_by')) ? `Requires attunement by ${pyStr(d.attune_by)}.\n\n` : '') + text };
  const bonus = int(toFloat(T(chosen) && role(item) ? get(chosen, 'bonus') : get(d, 'bonus')));
  if (bonus && role(item)) item.bonus = bonus;
  let effects = get(d, 'effects');
  if (effects === null) effects = itemEffectsFromText(text, { item_type: t, variants });
  effects = list(or(effects, [])).map((e) => ({ ...e }));
  if (T(chosen)) {
    for (const e of effects) {
      if (['spell_attack', 'spell_dc'].includes(get(e, 'type'))) {
        if (!Object.hasOwn(chosen, 'bonus')) throw new Error("KeyError: 'bonus'");
        e.value = chosen.bonus;
      }
    }
  }
  if (effects.length) item.effects = effects;
  const charges = int(toFloat(get(d, 'charges')));
  if (charges) item.charges = { max: charges, used: 0, regain: or(get(d, 'regain'), ''), when: or(get(d, 'when'), 'dawn') };
  if (T(variants)) item.variants = variants;
  if (note) item.notes = note;
  if (role(item) === 'weapon' || (item.kind === 'magic' && effects.length)) item.equipped = true;
  if (item.kind === 'consumable') item.equipped = false;
  return item;
}
