"""Magic item library entries for the parity and gear fixtures.

The SRD file the phone app ships has no magic items, so these stand in for what the PC app's wiki parser
(wikiparse.parse_magic_item) gives: the same fields, with short descriptions written for the tests. Most leave
out "effects" so gear.item_from_entry reads them from the text (wikiparse.item_effects_from_text).
"""

MAGIC_ITEMS = [
    {"name": "Ring of Protection", "data": {
        "item_type": "ring", "rarity": "rare", "attunement": True,
        "text": "You gain a +1 bonus to AC and saving throws while wearing this ring."}},
    {"name": "Cloak of Protection", "data": {
        "item_type": "wondrous", "rarity": "uncommon", "attunement": True,
        "text": "You gain a +1 bonus to AC and saving throws while you wear this cloak."}},
    {"name": "Bracers of Defense", "data": {
        "item_type": "wondrous", "rarity": "rare", "attunement": True,
        "text": "While wearing these bracers, you gain a +2 bonus to AC if you are wearing no armor and using no shield."}},
    {"name": "Gauntlets of Ogre Power", "data": {
        "item_type": "wondrous", "rarity": "uncommon", "attunement": True,
        "text": "Your Strength score is 19 while you wear these gauntlets. They have no effect on you if your Strength "
                "is already 19 or higher."}},
    {"name": "Belt of Dwarvenkind", "data": {
        "item_type": "wondrous", "rarity": "rare", "attunement": True,
        "text": "While wearing this belt, your Constitution score increases by 2, to a maximum of 20. You have "
                "resistance to poison damage."}},
    {"name": "Tome of Clear Thought", "data": {
        "item_type": "wondrous", "rarity": "very rare",
        "text": "Your Intelligence score increases by 2, as does your maximum for that score."}},
    {"name": "Boots of Speed", "data": {
        "item_type": "wondrous", "rarity": "rare", "attunement": True,
        "text": "While you wear these boots, your walking speed increases by 10 feet.  Something else happens too."}},
    {"name": "Sentinel Shield", "data": {
        "item_type": "shield", "rarity": "uncommon", "type_detail": "shield",
        "text": "You have advantage on initiative rolls while you hold this shield. You gain a +2 bonus to initiative."}},
    {"name": "Weapon, +1, +2, or +3", "data": {
        "item_type": "weapon", "rarity": "varies", "type_detail": "any weapon",
        "variants": [{"rarity": "uncommon", "bonus": 1}, {"rarity": "rare", "bonus": 2}, {"rarity": "very rare", "bonus": 3}],
        "bonus": 1,
        "text": "You have a bonus to attack and damage rolls made with this magic weapon. The bonus is determined by "
                "the weapon's rarity."}},
    {"name": "Flame Tongue", "data": {
        "item_type": "weapon", "rarity": "rare", "attunement": True, "type_detail": "any sword",
        "text": "You can use a bonus action to speak this magic sword's command word, causing flames to erupt from the "
                "blade. While the sword is ablaze, it deals an extra 2d6 fire damage to any target it hits."}},
    {"name": "Frost Brand", "data": {
        "item_type": "weapon", "rarity": "very rare", "attunement": True, "type_detail": "any sword",
        "text": "When you hit with an attack using this magic sword, the target takes an extra 1d6 cold damage! "
                "In addition, while you hold the sword, you have resistance to fire damage."}},
    {"name": "Dagger of Venom", "data": {
        "item_type": "weapon", "rarity": "rare", "works_as": "Dagger",
        "text": "You gain a +1 bonus to attack and damage rolls made with this magic weapon."}},
    {"name": "Javelin of Lightning", "data": {
        "item_type": "weapon", "rarity": "uncommon", "type_detail": "javelin", "works_as": "javelin",
        "text": "This javelin is a magic weapon. When you hurl it, it deals an extra 4d6 lightning damage."}},
    {"name": "Arrow of Slaying", "data": {
        "item_type": "ammunition", "rarity": "very rare", "type_detail": "arrow",
        "text": "A creature hit by this arrow takes an extra 6d10 piercing damage."}},
    {"name": "Armor, +1, +2, or +3", "data": {
        "item_type": "armor", "rarity": "varies", "type_detail": "light, medium, or heavy",
        "variants": [{"rarity": "rare", "bonus": 1}, {"rarity": "very rare", "bonus": 2}, {"rarity": "legendary", "bonus": 3}],
        "text": "You have a bonus to AC while wearing this armor."}},
    {"name": "Elven Chain", "data": {
        "item_type": "armor", "rarity": "rare", "type_detail": "chain shirt", "works_as": "Chain shirt", "bonus": 1,
        "text": "You gain a +1 bonus to AC while you wear this armor."}},
    {"name": "Dragon Scale Mail", "data": {
        "item_type": "armor", "rarity": "very rare", "attunement": True, "type_detail": "scale",
        "text": "While wearing this armor, you gain a +1 bonus to AC and you have resistance to fire damage."}},
    {"name": "Staff of Power", "data": {
        "item_type": "staff", "rarity": "very rare", "attunement": True, "attune_by": "a sorcerer, warlock, or wizard",
        "works_as": "Quarterstaff", "charges": 20, "regain": "2d8+4", "when": "dawn",
        "text": "This staff can be wielded as a magic quarterstaff that grants a +2 bonus to attack and damage rolls made "
                "with it. While holding it, you gain a +2 bonus to Armor Class, saving throws, and spell attack rolls. "
                "The staff has 20 charges. On a hit it deals an extra 1d6 force damage if you expend 1 charge."}},
    {"name": "Wand of the War Mage, +1, +2, or +3", "data": {
        "item_type": "wand", "rarity": "varies", "attunement": True, "attune_by": "a spellcaster",
        "variants": [{"rarity": "uncommon", "bonus": 1}, {"rarity": "rare", "bonus": 2}, {"rarity": "very rare", "bonus": 3}],
        "text": "While holding this wand, you gain a bonus to spell attack rolls determined by the wand's rarity."}},
    {"name": "Rod of the Pact Keeper", "data": {
        "item_type": "rod", "rarity": "varies", "attunement": True, "attune_by": "a warlock",
        "variants": [{"rarity": "uncommon", "bonus": 1}, {"rarity": "rare", "bonus": 2}],
        "text": "While holding this rod, you gain a bonus to spell attack rolls and to the saving throw DCs of your "
                "warlock spells. The bonus is determined by the rod's rarity."}},
    {"name": "Robe of the Archmagi", "data": {
        "item_type": "wondrous", "rarity": "legendary", "attunement": True,
        "text": "Your spell save DC and spell attack bonus each increase by 2. You have resistance to all damage of "
                "some kinds."}},
    {"name": "Amulet of Health", "data": {
        "item_type": "wondrous", "rarity": "rare", "attunement": True,
        "effects": [{"type": "score_set", "ability": "con", "value": 19}, {"type": "hp", "value": "3"}]}},
    {"name": "Luckstone", "data": {
        "item_type": "wondrous", "rarity": "uncommon", "attunement": True,
        "effects": [{"type": "skill", "skill": "Stealth", "value": 1}, {"type": "save", "ability": "dex", "value": 1},
                    {"type": "note", "text": "  Advantage on one roll a day.  "}, {"type": "init", "value": 0},
                    {"type": "attack", "value": -1}, {"type": "damage", "value": 2.7}]}},
    {"name": "Potion of Giant Strength", "data": {
        "item_type": "potion", "rarity": "rare",
        "text": "When you drink this potion, your Strength score changes to 21 for 1 hour. You gain a +1 bonus to AC."}},
    {"name": "Spell Scroll", "data": {"item_type": "scroll", "rarity": "common", "text": "A spell written on a scroll."}},
    {"name": "Bag of Holding", "data": {"item_type": "wondrous", "rarity": "uncommon", "text": "This bag is bigger inside."}},
    {"name": "Wand of Magic Missiles", "data": {
        "item_type": "wand", "rarity": "uncommon", "charges": "7", "regain": "1d6+1",
        "text": "This wand has 7 charges. It regains 1d6 + 1 expended charges daily at dawn."}},
    {"name": "Mystery Thing", "data": {}},
    {"name": "", "data": {"item_type": "ring", "rarity": "rare", "description": "You gain a +1 bonus to AC."}},
]
