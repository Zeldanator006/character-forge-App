"""Sample pages shaped like dnd5e.wikidot.com pages, for tools/wiki_fixtures.py.

They copy the wiki's markup (page wrapper, yui tab sets, tables, bold option lists) with invented or SRD 5.1
text, so the parsers get exercised on every structure they read. The PC app's tests/fixtures.py has more.
"""


def page(title, content):
    return f"""<html><head><title>{title} - DND 5th Edition</title>
<script>var x = "<p>not page text</p>";</script></head><body>
<div id="header"><h1><a href="/">DND 5th Edition</a></h1></div>
<div id="page-title"> {title} </div>
<div id="page-content">
<!-- a comment the parsers skip -->
{content}
<div class="footnotes-footer">Footnotes</div>
</div>
<div class="page-tags"><span><a href="/system:page-tags/tag/x">x</a></span></div>
</body></html>"""


TABBED_SPELLS = page("Cleric Spells", """
<div class="yui-navset yui-navset-top">
<ul class="yui-nav"><li class="selected title"><a href="javascript:;"><em>Cantrip</em></a></li>
<li><a href="javascript:;"><em>1st Level</em></a></li><li><a href="javascript:;"><em>2nd Level</em></a></li></ul>
<div class="yui-content">
<div id="wiki-tab-0-0"><div class="list-pages-box"><div class="list-pages-item">
<table class="wiki-content-table"><tr><th>Spell Name</th><th>School</th><th>Casting Time</th><th>Range</th><th>Duration</th><th>Components</th></tr>
<tr><td><a href="/spell:guidance">Guidance</a></td><td>Divination</td><td>1 Action</td><td>Touch</td><td>Concentration, up to 1 minute</td><td>V, S</td></tr>
<tr><td><a href="/spell:light">Light</a></td><td>Evocation</td><td>1 Action</td><td>Touch</td><td>1 hour</td><td>V, M</td></tr>
</table></div></div></div>
<div id="wiki-tab-0-1"><table class="wiki-content-table"><tr><th>Spell Name</th><th>School</th><th>Casting Time</th><th>Range</th><th>Duration</th><th>Components</th></tr>
<tr><td><a href="/spell:bless">Bless</a></td><td>Enchantment</td><td>1 Action</td><td>30 Feet</td><td>Concentration, up to 1 minute</td><td>V, S, M</td></tr>
<tr><td><a href="/spell:detect-magic">Detect Magic</a></td><td>Divination</td><td>1 Action R</td><td>Self</td><td>Concentration, up to 10 minutes</td><td>V, S</td></tr>
<tr><td><a href="/spell:ceremony">Ceremony (UA)</a></td><td>Abjuration DG</td><td>1 Hour R</td><td>Touch</td><td>Instantaneous</td><td>V, S, M</td></tr>
</table></div>
<div id="wiki-tab-0-2"><table class="wiki-content-table"><tr><th>Spell Name</th><th>School</th><th>Casting Time</th><th>Range</th><th>Duration</th><th>Components</th></tr>
<tr><td><a href="/spell:aid">Aid</a></td><td>Abjuration T</td><td>1 Action</td><td>30 Feet</td><td>8 hours</td><td>V, S, M</td></tr>
</table></div>
</div></div>
""")

UNTABBED_SPELLS = page("Spells", "".join(
    f"""<h2>Level {i}</h2><table><tr><td><a href="/spell:s{i}a">Spell {i}A</a></td><td>Evocation</td><td>1 Action</td>
<td>60 feet</td><td>Instantaneous</td><td>V, S</td></tr></table>""" for i in range(10)))

FIGHTER = page("Fighter", """
<h1><span>Class Features</span></h1>
<p>As a fighter, you gain the following class features.</p>
<h3><span>Hit Points</span></h3>
<p><strong>Hit Dice:</strong> 1d10 per fighter level<br />
<strong>Hit Points at 1st Level:</strong> 10 + your Constitution modifier</p>
<h3><span>Proficiencies</span></h3>
<p><strong>Armor:</strong> All armor, shields<br /><strong>Weapons:</strong> Simple weapons, martial weapons<br />
<strong>Tools:</strong> None<br /><strong>Saving Throws:</strong> Strength, Constitution<br />
<strong>Skills:</strong> Choose two skills from Acrobatics, Animal Handling, Athletics, History, Insight, Intimidation, Perception, and Survival</p>
<h3><span>Equipment</span></h3>
<p>You start with the following equipment, in addition to the equipment granted by your background:</p>
<ul><li>(<em>a</em>) chain mail or (<em>b</em>) leather armor, longbow, and 20 arrows</li>
<li>(<em>a</em>) a martial weapon and a shield or (<em>b</em>) two martial weapons</li>
<li>(<em>a</em>) a light crossbow and 20 bolts or (<em>b</em>) two handaxes</li></ul>
<table class="wiki-content-table"><tr><th colspan="3">The Fighter</th></tr>
<tr><th>Level</th><th>Proficiency Bonus</th><th>Features</th></tr>
<tr><td>1st</td><td>+2</td><td>Fighting Style, Second Wind</td></tr>
<tr><td>2nd</td><td>+2</td><td>Action Surge (one use)</td></tr>
<tr><td>3rd</td><td>+2</td><td>Martial Archetype</td></tr>
<tr><td>4th</td><td>+2</td><td>Ability Score Improvement</td></tr>
<tr><td>6th</td><td>+3</td><td>Ability Score Improvement</td></tr>
<tr><td>9th</td><td>+4</td><td>Indomitable (one use)</td></tr></table>
<h3><span>Fighting Style</span></h3>
<p>You adopt a particular style of fighting as your specialty. Choose one of the following options.</p>
<ul><li><strong>Archery.</strong> You gain a +2 bonus to attack rolls you make with ranged weapons.</li>
<li><strong>Defense.</strong> While you are wearing armor, you gain a +1 bonus to AC.</li>
<li><strong>Blind Fighting (TCoE).</strong> You have blindsight with a range of 10 feet.</li>
<li> <strong>Dueling:</strong> When you are wielding a melee weapon in one hand, you gain a +2 bonus to damage rolls.</li></ul>
<h3><span>Second Wind</span></h3>
<p>You have a limited well of stamina. On your turn, you can use a bonus action to regain hit points equal to 1d10 + your fighter level.</p>
<h3><span>Action Surge</span></h3>
<p>Starting at 2nd level, you can push yourself beyond your normal limits for a moment.</p>
<h3><span>Martial Archetype</span></h3>
<p>At 3rd level, you choose an archetype.</p>
<table class="wiki-content-table"><tr><th>Archetype</th><th>Source</th></tr>
<tr><td><a href="/fighter:champion">Champion</a></td><td>Player's Handbook</td></tr>
<tr><td><a href="/fighter:battle-master">Battle Master</a></td><td>Player's Handbook</td></tr>
<tr><td>Unearthed Arcana</td><td></td></tr>
<tr><td><a href="/fighter:brute">Brute</a></td><td>Unearthed Arcana</td></tr></table>
<h3><span>Indomitable</span></h3>
<p>Beginning at 9th level, you can reroll a saving throw that you fail.</p>
""")

SORCERER_METAMAGIC = page("Sorcerer", """
<h3><span>Hit Points</span></h3><p><strong>Hit Dice:</strong> 1d6 per sorcerer level</p>
<p><strong>Saving Throws:</strong> Constitution, Charisma<br /><strong>Skills:</strong> Choose any three</p>
<p>Charisma is your spellcasting ability for your sorcerer spells.</p>
<h3><span>Metamagic</span></h3>
<p>At 3rd level, you gain the ability to twist your spells. You gain two of the following Metamagic options of your choice. You gain another one at 10th and 17th level.</p>
<ul><li><strong>Careful Spell.</strong> When you cast a spell that forces other creatures to make a saving throw, you can protect some of them.</li>
<li><strong>Distant Spell.</strong> When you cast a spell that has a range of 5 feet or greater, you can double the range.</li>
<li><strong>Empowered Spell.</strong> When you roll damage for a spell, you can reroll a number of the damage dice.<ul><li><strong>Nested.</strong> not an option</li></ul></li></ul>
""")

BACKGROUND = page("Background: Sage", """
<p>Source: Player's Handbook</p>
<p>You spent years learning the lore of the multiverse.</p>
<p><strong>Skill Proficiencies:</strong> Arcana, History<br />
<strong>Languages:</strong> Two of your choice<br />
<strong>Equipment:</strong> A bottle of black ink, a quill, a small knife, a letter from a dead colleague, a set of common clothes, and a belt pouch containing 10 gp</p>
<h3><span>Feature: Researcher</span></h3>
<p>When you attempt to learn or recall a piece of lore, you often know where to find it.</p>
<h3><span>Suggested Characteristics</span></h3>
<p>Sages are defined by their extensive studies.</p>
<table class="wiki-content-table"><tr><th>d8</th><th>Personality Trait</th></tr>
<tr><td>1</td><td>I use polysyllabic words that convey the impression of great erudition.</td></tr>
<tr><td>2</td><td>I've read every book in the world's greatest libraries.</td></tr></table>
<h5>Ideal</h5>
<table class="wiki-content-table"><tr><th>d6</th><th>Ideal</th></tr>
<tr><td>1</td><td>Knowledge. The path to power is through knowledge. (Neutral)</td></tr></table>
<h5>Bond</h5>
<table><tr><td>1</td><td>It is my duty to protect my students.</td></tr></table>
<h5>Flaw</h5>
<table><tr><td>1</td><td>I am easily distracted by the promise of information.</td></tr></table>
""")

BACKGROUND_CHOICE = page("Background: Haunted One", """
<p><strong>Skill Proficiencies:</strong> Choose two from among Arcana, Investigation, Religion, or Survival</p>
<p><strong>Feature:</strong> Heart of Darkness</p>
""")

MAGIC_ITEMS = page("Magic Items", """
<div class="yui-navset yui-navset-top">
<ul class="yui-nav"><li><a href="javascript:;"><em>Common</em></a></li><li><a href="javascript:;"><em>Uncommon</em></a></li>
<li><a href="javascript:;"><em>Rare</em></a></li></ul>
<div class="yui-content">
<div><table class="wiki-content-table"><tr><th>Item Name</th><th>Type</th><th>Attuned</th><th>Source</th></tr>
<tr><td><a href="/wondrous-items:candle-of-the-deep">Candle of the Deep</a></td><td>Wondrous Item</td><td>-</td><td>Xanathar's Guide</td></tr>
<tr><td><a href="/wondrous-items:mystery-key">Mystery Key</a></td><td>Wondrous Item</td><td>No</td><td>Xanathar's Guide</td></tr></table></div>
<div><table class="wiki-content-table"><tr><th>Item Name</th><th>Type</th><th>Attuned</th><th>Source</th></tr>
<tr><td><a href="/wondrous-items:bag-of-holding">Bag of Holding</a></td><td>Wondrous Item</td><td>-</td><td>Dungeon Master's Guide</td></tr>
<tr><td><a href="/wondrous-items:cloak-of-protection">Cloak of Protection</a></td><td>Wondrous Item</td><td>Attuned</td><td>DMG</td></tr>
<tr><td><a href="/wondrous-items:weapon-plus-1">Weapon, +1</a></td><td>Weapon</td><td>-</td><td>DMG</td></tr>
<tr><td><a href="/wondrous-items:homebrew-hat">Fancy Hat</a></td><td>Wondrous Item</td><td>-</td><td>HB</td></tr></table></div>
<div><table class="wiki-content-table"><tr><th>Item Name</th><th>Type</th><th>Attuned</th><th>Source</th></tr>
<tr><td><a href="/wondrous-items:ring-of-protection">Ring of Protection</a></td><td>Ring</td><td>Attuned</td><td>DMG</td></tr>
<tr><td><a href="/wondrous-items:arcane-grenade">Arcane Grenade (UA)</a></td><td>Wondrous Item</td><td>-</td><td>UA</td></tr></table></div>
</div></div>
""")

ITEM_CLOAK = page("Cloak of Protection", """
<p>Source: Dungeon Master's Guide</p>
<p><em>Wondrous item, uncommon (requires attunement)</em></p>
<p>You gain a +1 bonus to AC and saving throws while you wear this cloak.</p>
<p>This text is from a page on the DND 5th Edition community wiki and is quoted for reference.</p>
""")

ITEM_WEAPON = page("Weapon, +1, +2, or +3", """
<p><em>Weapon (any), uncommon (+1), rare (+2), or very rare (+3)</em></p>
<p>You have a bonus to attack and damage rolls made with this magic weapon. The bonus is determined by the weapon's rarity.</p>
""")

ITEM_STAFF = page("Staff of Fire", """
<p><em>Staff, very rare (requires attunement by a druid, sorcerer, warlock, or wizard)</em></p>
<p>You have resistance to fire damage while you hold this staff.</p>
<p>The staff has 10 charges. The staff regains 1d6 + 4 expended charges daily at dawn.</p>
<p>When you hit with a melee attack using this quarterstaff, the target takes an extra 1d6 fire damage.</p>
""")

ITEM_SWORD = page("Flame Tongue", """
<p><em>Weapon (longsword), rare (requires attunement)</em></p>
<p>You can use a bonus action to speak this magic sword's command word, causing flames to erupt from the blade. While the sword is ablaze, it deals an extra 2d6 fire damage to any target it hits.</p>
<p>You gain a +2 bonus to attack and damage rolls made with this weapon.</p>
""")

ITEM_ARMOR = page("Adamantine Armor", """
<p><em>Armor (medium or heavy, but not hide), uncommon</em></p>
<p>This suit of armor is reinforced with adamantine. While you're wearing it, any critical hit against you becomes a normal hit.</p>
""")

ITEM_SHIELD = page("Sentinel Shield", """
<p><em>Armor (shield), uncommon</em></p>
<p>While holding this shield, you have advantage on initiative rolls. You gain a +1 bonus to AC in addition to the shield's normal bonus.</p>
""")

ITEM_BELT = page("Belt of Giant Strength", """
<p><em>Wondrous item, rarity varies (requires attunement)</em></p>
<p>While wearing this belt, your Strength score changes to 21. Your speed increases by 10 feet.</p>
<p>Your Constitution score increases by 2, to a maximum of 22.</p>
""")

INVOCATIONS = page("Warlock: Eldritch Invocations", """
<p>Source: Player's Handbook</p>
<h1><span>Eldritch Invocations</span></h1>
<h3><span>Agonizing Blast</span></h3>
<p><em>Prerequisite: eldritch blast cantrip</em></p>
<p>When you cast eldritch blast, add your Charisma modifier to the damage it deals on a hit.</p>
<h3><span>Armor of Shadows</span></h3>
<p>You can cast mage armor on yourself at will.</p>
<h3><span>Thirsting Blade</span></h3>
<p><strong>Prerequisites:</strong> 5th level, Pact of the Blade feature</p>
<p>You can attack with your pact weapon twice.</p>
<h2><span>Unearthed Arcana</span></h2>
<h3><span>Aspect of the Moon (UA)</span></h3>
<p>You no longer need to sleep.</p>
""")

OPTION_TABLE = page("Artificer: Infusions", """
<table><tr><th>Infusion</th><th>Item</th></tr>
<tr><td>Enhanced Defense</td><td>A suit of armor or a shield</td></tr>
<tr><td>Repeating Shot</td><td>A simple or martial weapon with the ammunition property</td></tr></table>
""")

HUMAN = page("Human", """
<div class="yui-navset yui-navset-top"><ul class="yui-nav"><li><a href="javascript:;"><em>Standard</em></a></li>
<li><a href="javascript:;"><em>Variant</em></a></li></ul><div class="yui-content">
<div><p>Source: Player's Handbook</p><ul><li><strong>Ability Score Increase.</strong> Your ability scores each increase by 1.</li>
<li><strong>Size.</strong> Your size is Medium.</li><li><strong>Speed.</strong> Your base walking speed is 30 feet.</li>
<li><strong>Languages.</strong> You can speak, read, and write Common and one extra language of your choice.</li></ul></div>
<div><ul><li><strong>Ability Score Increase.</strong> Two different ability scores of your choice increase by 1.</li>
<li><strong>Skills.</strong> You gain proficiency in one skill of your choice.</li>
<li><strong>Feat.</strong> You gain one feat of your choice.</li></ul></div>
</div></div>
""")

HALF_ELF = page("Half-Elf", """
<h1>Half-Elf</h1>
<p>Source: Player's Handbook</p>
<ul><li><strong>Ability Score Increase.</strong> Your Charisma score increases by 2, and two other ability scores of your choice increase by 1.</li>
<li><strong>Darkvision.</strong> You can see in dim light within 60 feet of you as if it were bright light.</li>
<li><strong>Skill Versatility.</strong> You gain proficiency in two skills of your choice.</li></ul>
<p>An extra paragraph that belongs to Skill Versatility.</p>
<h1>Mark of Detection Half-Elf</h1>
<ul><li><strong>Ability Score Increase.</strong> Your Wisdom score increases by 2, and one other ability score of your choice increases by 1.</li>
<li><strong>Speed.</strong> Your walking speed is 30 feet.</li></ul>
<h2>Subrace Test</h2>
<ul><li><strong>Keen Senses.</strong> You have proficiency in the Perception skill.</li></ul>
""")

FEAT_ANY = page("Skill Expert", """
<p>Source: Tasha's Cauldron of Everything</p>
<ul><li>Increase one ability score of your choice by 1, to a maximum of 20.</li>
<li>You gain proficiency in one skill of your choice.</li></ul>
""")

PAGES = {k: v for k, v in globals().items() if k.isupper() and isinstance(v, str) and v.startswith("<html")}
