/**
 * profile.js — Full SkyCrypt-accurate Skyblock profile viewer
 *
 * Ported from SkyCrypt-development source (skills, dungeons, slayer, weight).
 * Uses real XP tables, level caps, and stat formulas.
 *
 * Pages: Overview / Skills / Dungeons / Slayers / Mining
 * Navigation via 5-button row. 5-min inactivity timeout.
 */
import {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import {
  getUUID, getActiveProfile, getSkyblockProfiles, getPlayerData, cleanItemName,
} from '../../services/hypixel.js';
import { getDb } from '../../utils/db.js';
import { C, errorEmbed, formatCoins } from '../../utils/embeds.js';
import {
  getLevelByXp, getSlayerLevel, progressBar, formatXP,
  DEFAULT_SKILL_CAPS, COSMETIC_SKILLS, SLAYER_NAMES, DUNGEONEERING_XP,
} from '../../utils/leveling.js';

// ── Stat Calculation Helpers ─────────────────────────────────────────────────

const SKILL_KEYS = {
  farming:    'SKILL_FARMING',
  mining:     'SKILL_MINING',
  combat:     'SKILL_COMBAT',
  foraging:   'SKILL_FORAGING',
  fishing:    'SKILL_FISHING',
  enchanting: 'SKILL_ENCHANTING',
  alchemy:    'SKILL_ALCHEMY',
  taming:     'SKILL_TAMING',
  carpentry:  'SKILL_CARPENTRY',
  runecrafting:'SKILL_RUNECRAFTING',
};

const SKILL_EMOJI = {
  farming:     '🌾', mining:     '⛏️',  combat:     '⚔️',
  foraging:    '🌲', fishing:    '🎣',  enchanting: '📚',
  alchemy:     '⚗️',  taming:     '🐾',  carpentry:  '🪚',
  runecrafting:'🔮',
};

function calcSkills(member, playerData, farmingCapBoost = 0) {
  const exp = member?.player_data?.experience ?? {};
  const skills = {};
  let totalXp = 0;
  let skillSum = 0;
  let skillCount = 0;

  for (const [skill, key] of Object.entries(SKILL_KEYS)) {
    const xp  = exp[key] ?? 0;
    let cap = DEFAULT_SKILL_CAPS[skill] ?? 50;
    if (skill === 'farming') cap = Math.min(60, cap + farmingCapBoost);

    const data = getLevelByXp(xp, { skill, cap, type: skill === 'runecrafting' ? 'runecrafting' : undefined });
    skills[skill] = data;

    if (!COSMETIC_SKILLS.includes(skill)) {
      totalXp  += xp;
      skillSum += data.levelWithProgress;
      skillCount++;
    }
  }

  // Fallback: achievement-based (API off)
  if (!Object.values(exp).some(v => v > 0) && playerData) {
    const ach = playerData.achievements ?? {};
    const achMap = {
      farming: ach.skyblock_harvester ?? 0,
      mining:  ach.skyblock_excavator ?? 0,
      combat:  ach.skyblock_combat ?? 0,
      foraging:ach.skyblock_gatherer ?? 0,
      fishing: ach.skyblock_angler ?? 0,
      enchanting:ach.skyblock_augmentation ?? 0,
      alchemy: ach.skyblock_concoctor ?? 0,
      taming:  ach.skyblock_domesticator ?? 0,
    };
    for (const [s, lvl] of Object.entries(achMap)) {
      if (skills[s]) {
        skills[s].level = lvl;
        skills[s].levelWithProgress = lvl;
        skills[s].xp = 0;
        skills[s].apiOff = true;
      }
    }
  }

  const avgSkill = skillCount > 0 ? skillSum / skillCount : 0;
  return { skills, avgSkill, totalXp };
}

function calcDungeons(member) {
  const dungeons = member?.dungeons;
  if (!dungeons) return null;

  const cata = dungeons.dungeon_types?.catacombs;
  const master = dungeons.dungeon_types?.master_catacombs;

  const cataLevel = getLevelByXp(cata?.experience ?? 0, {
    type: 'dungeoneering', skill: 'dungeoneering', infinite: true, ignoreCap: true,
  });

  // Floors
  function parseFloors(data) {
    if (!data) return {};
    const floors = {};
    const tierCompletions = data.tier_completions ?? {};
    const bestScores = data.best_score ?? {};
    const fastestSPlus = data.fastest_time_s_plus ?? {};
    const highestFloor = data.highest_tier_completed ?? 0;
    for (let i = 0; i <= highestFloor; i++) {
      floors[i] = {
        completions: tierCompletions[i] ?? 0,
        bestScore: bestScores[i] ?? 0,
        fastestSPlus: fastestSPlus[i] ?? null,
      };
    }
    return floors;
  }

  // Classes
  const classes = {};
  for (const [cls, data] of Object.entries(dungeons.player_classes ?? {})) {
    classes[cls] = getLevelByXp(data.experience ?? 0, {
      type: 'dungeoneering', skill: 'dungeoneering', infinite: true, ignoreCap: true,
    });
  }

  const selectedClass = dungeons.selected_dungeon_class ?? 'none';

  // Essence
  const essence = {};
  const essenceData = member?.currencies?.essence ?? {};
  for (const [type, data] of Object.entries(essenceData)) {
    essence[type.toLowerCase()] = data.current ?? 0;
  }

  return {
    cataLevel,
    highestFloor: cata?.highest_tier_completed ?? 0,
    highestMasterFloor: master?.highest_tier_completed ?? 0,
    cataFloors: parseFloors(cata),
    masterFloors: parseFloors(master),
    classes,
    selectedClass,
    essence,
    totalCompletions:
      Object.values(cata?.tier_completions ?? {}).reduce((a, b) => a + b, 0) +
      Object.values(master?.tier_completions ?? {}).reduce((a, b) => a + b, 0),
  };
}

function calcSlayers(member) {
  const slayerBosses = member?.slayer?.slayer_bosses ?? {};
  const slayers = {};
  let totalXp = 0;

  for (const [name, data] of Object.entries(slayerBosses)) {
    const xp = data.xp ?? 0;
    slayers[name] = {
      ...getSlayerLevel(xp, name),
      kills: {},
    };
    // Count kills per tier
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('boss_kills_tier_')) {
        const tier = parseInt(k.split('_').at(-1)) + 1;
        slayers[name].kills[tier] = v;
      }
    }
    totalXp += xp;
  }

  return { slayers, totalXp };
}

function calcNetworth(member, profile) {
  const purse = member?.currencies?.coin_purse ?? member?.coin_purse ?? 0;
  const bank  = profile?.banking?.balance ?? 0;
  // Basic networth: purse + bank (full item networth requires skyhelper-networth package)
  return { purse, bank, total: purse + bank, note: 'coins only' };
}

function calcSkyblockLevel(member) {
  const xp = member?.leveling?.experience ?? 0;
  // Each SB level costs 100 XP
  const level = Math.floor(xp / 100);
  const progress = (xp % 100) / 100;
  return { level, xp, progress };
}

function calcHotm(member) {
  const xp = member?.mining_core?.experience ?? 0;
  const tokens = member?.mining_core?.tokens ?? 0;
  const tokensSpent = member?.mining_core?.tokens_spent ?? 0;
  return { ...getLevelByXp(xp, { type: 'hotm' }), tokens, tokensSpent };
}

function formatTime(ms) {
  if (!ms) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Embed Builders ────────────────────────────────────────────────────────────

function buildOverviewEmbed(ign, uuid, profileName, rank, sb, skills, dungeons, slayers, nw) {
  const rankLabel = rank && rank !== 'NONE' && rank !== 'NON' ? `[${rank}] ` : '';

  const skillFields = [
    'farming','mining','combat','foraging','fishing','enchanting','alchemy','taming',
  ].map(s => {
    const d = skills.skills[s];
    if (!d) return null;
    const bar = progressBar(d.progress, 8);
    const lvlStr = d.apiOff ? `${d.level}*` : `${d.level}`;
    return `${SKILL_EMOJI[s]} **${s.charAt(0).toUpperCase()+s.slice(1)}** \`${lvlStr}\` ${bar}`;
  }).filter(Boolean);

  const catLvl   = dungeons?.cataLevel?.level ?? 0;
  const catProg  = progressBar(dungeons?.cataLevel?.progress ?? 0, 8);
  const selClass = dungeons?.selectedClass ?? 'none';
  const classLvl = dungeons?.classes?.[selClass]?.level ?? 0;

  const slayerLines = Object.entries(slayers.slayers ?? {}).map(([name, d]) => {
    const emoji = { zombie:'🧟', spider:'🕷️', wolf:'🐺', enderman:'👾', blaze:'🔥', vampire:'🧛' }[name] ?? '⚔️';
    return `${emoji} **${SLAYER_NAMES[name] ?? name}** LVL ${d.level} (${formatXP(d.xp)} XP)`;
  }).join('\n') || 'No slayers';

  return new EmbedBuilder()
    .setColor(C.carry)
    .setAuthor({ name: `${rankLabel}${ign}`, iconURL: `https://mc-heads.net/avatar/${uuid}/32` })
    .setTitle(`📊 ${profileName} — Overview`)
    .setThumbnail(`https://mc-heads.net/body/${uuid}/right`)
    .addFields(
      {
        name: '⭐ SkyBlock Level',
        value: `**${sb.level}** ${progressBar(sb.progress, 10)} \`${sb.xp % 100}/100 XP\``,
        inline: false,
      },
      {
        name: `🎯 Skill Avg: **${skills.avgSkill.toFixed(2)}**`,
        value: skillFields.slice(0, 4).join('\n'),
        inline: true,
      },
      {
        name: '\u200b',
        value: skillFields.slice(4).join('\n'),
        inline: true,
      },
      {
        name: `⚔️ Catacombs **${catLvl}** ${catProg}`,
        value: `Class: **${selClass.charAt(0).toUpperCase()+selClass.slice(1)}** LVL ${classLvl}\nHighest Floor: **F${dungeons?.highestFloor ?? 0}** | M${dungeons?.highestMasterFloor ?? 0}`,
        inline: false,
      },
      {
        name: '🗡️ Slayers',
        value: slayerLines,
        inline: false,
      },
      {
        name: '💰 Coins',
        value: `Purse: **${formatCoins(nw.purse)}** | Bank: **${formatCoins(nw.bank)}**\nTotal: **${formatCoins(nw.total)}** *(coins only)*`,
        inline: false,
      },
    )
    .setFooter({ text: `SkyBot v2 • Powered by Hypixel API${skills.skills.farming?.apiOff ? ' • *API off (achievement fallback)' : ''}` })
    .setTimestamp();
}

function buildSkillsEmbed(ign, uuid, profileName, skills) {
  const lines = Object.entries(skills.skills).map(([name, d]) => {
    const emoji = SKILL_EMOJI[name] ?? '•';
    const bar   = progressBar(d.progress, 10);
    const xpStr = d.xp ? `${formatXP(d.xpCurrent)} / ${formatXP(d.xpForNext === Infinity ? 0 : d.xpForNext)} XP` : 'API off';
    const cap   = d.levelCap !== d.maxLevel ? ` (cap ${d.levelCap})` : '';
    return `${emoji} **${name.charAt(0).toUpperCase()+name.slice(1)}** — LVL \`${d.level}${cap}\`\n${bar} ${xpStr}`;
  });

  return new EmbedBuilder()
    .setColor(C.success)
    .setAuthor({ name: ign, iconURL: `https://mc-heads.net/avatar/${uuid}/32` })
    .setTitle(`🎯 ${profileName} — Skills`)
    .setDescription(lines.join('\n\n'))
    .addFields(
      { name: 'Skill Average', value: `**${skills.avgSkill.toFixed(2)}**`, inline: true },
      { name: 'Total Skill XP', value: formatXP(skills.totalXp), inline: true },
    )
    .setFooter({ text: 'SkyBot v2 • SkyCrypt-accurate XP tables' })
    .setTimestamp();
}

function buildDungeonsEmbed(ign, uuid, profileName, dungeons) {
  if (!dungeons) {
    return new EmbedBuilder().setColor(C.error).setTitle('No dungeon data found.').setTimestamp();
  }

  const { cataLevel, cataFloors, masterFloors, classes, selectedClass, essence } = dungeons;

  // Floor table
  const floorRows = Object.entries(cataFloors).map(([f, d]) =>
    `**F${f}** — ${d.completions}x | Best: ${d.bestScore} | S+: ${formatTime(d.fastestSPlus)}`
  ).join('\n') || 'No floors completed';

  const masterRows = Object.entries(masterFloors).map(([f, d]) =>
    `**M${f}** — ${d.completions}x | Best: ${d.bestScore} | S+: ${formatTime(d.fastestSPlus)}`
  ).join('\n') || 'No master floors completed';

  const classLines = Object.entries(classes).map(([cls, d]) => {
    const sel = cls === selectedClass ? ' ← selected' : '';
    return `${cls.charAt(0).toUpperCase()+cls.slice(1)}: LVL **${d.level}** (${formatXP(d.xp)} XP)${sel}`;
  }).join('\n') || 'No class data';

  const essenceLines = Object.entries(essence)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k.charAt(0).toUpperCase()+k.slice(1)}: **${v.toLocaleString()}**`)
    .join(' | ') || 'None';

  return new EmbedBuilder()
    .setColor(C.leveling)
    .setAuthor({ name: ign, iconURL: `https://mc-heads.net/avatar/${uuid}/32` })
    .setTitle(`⚔️ ${profileName} — Dungeons`)
    .addFields(
      {
        name: `Catacombs — LVL ${cataLevel.level} (${formatXP(cataLevel.xp)} XP)`,
        value: `${progressBar(cataLevel.progress, 12)} ${formatXP(cataLevel.xpCurrent)}/${formatXP(cataLevel.xpForNext === Infinity ? 0 : cataLevel.xpForNext)} XP\nTotal Completions: **${dungeons.totalCompletions}**`,
        inline: false,
      },
      { name: 'Normal Floors', value: floorRows,  inline: true },
      { name: 'Master Floors', value: masterRows, inline: true },
      { name: 'Classes',       value: classLines, inline: false },
      { name: 'Essence',       value: essenceLines, inline: false },
    )
    .setFooter({ text: 'SkyBot v2 • SkyCrypt-accurate dungeon data' })
    .setTimestamp();
}

function buildSlayerEmbed(ign, uuid, profileName, slayers) {
  const slayerEmoji = {
    zombie:'🧟', spider:'🕷️', wolf:'🐺', enderman:'👾', blaze:'🔥', vampire:'🧛',
  };

  const fields = Object.entries(slayers.slayers ?? {}).map(([name, d]) => {
    const emoji = slayerEmoji[name] ?? '⚔️';
    const bar   = progressBar(d.progress, 10);
    const killLines = Object.entries(d.kills ?? {})
      .map(([tier, count]) => `T${tier}: ${count}`)
      .join(' | ') || 'No kills';
    return {
      name: `${emoji} ${SLAYER_NAMES[name] ?? name} — LVL ${d.level}/${d.maxLevel}`,
      value: `${bar} ${formatXP(d.xp)} XP\n${killLines}`,
      inline: false,
    };
  });

  if (!fields.length) fields.push({ name: 'No Slayers', value: 'No slayer data found.', inline: false });

  return new EmbedBuilder()
    .setColor(C.error)
    .setAuthor({ name: ign, iconURL: `https://mc-heads.net/avatar/${uuid}/32` })
    .setTitle(`🗡️ ${profileName} — Slayers`)
    .addFields(...fields)
    .addFields({ name: 'Total Slayer XP', value: formatXP(slayers.totalXp), inline: true })
    .setFooter({ text: 'SkyBot v2 • SkyCrypt-accurate slayer data' })
    .setTimestamp();
}

function buildMiningEmbed(ign, uuid, profileName, member) {
  const hotm   = calcHotm(member);
  const mithril = member?.mining_core?.powder_mithril ?? 0;
  const mithrilSpent = member?.mining_core?.powder_mithril_total ?? 0;
  const gemstone = member?.mining_core?.powder_gemstone ?? 0;
  const gemstoneSpent = member?.mining_core?.powder_gemstone_total ?? 0;
  const glacite = member?.mining_core?.powder_glacite ?? 0;
  const nucleusRuns = member?.mining_core?.greater_mines_last_claimed ?? 0;

  return new EmbedBuilder()
    .setColor(C.info)
    .setAuthor({ name: ign, iconURL: `https://mc-heads.net/avatar/${uuid}/32` })
    .setTitle(`⛏️ ${profileName} — Mining / HoTM`)
    .addFields(
      {
        name: `HoTM Level ${hotm.level}`,
        value: `${progressBar(hotm.progress, 12)} ${formatXP(hotm.xpCurrent)} / ${formatXP(hotm.xpForNext === Infinity ? 0 : hotm.xpForNext)} XP\nTokens Available: **${hotm.tokens}** | Spent: **${hotm.tokensSpent}**\nNucleus Runs: **${nucleusRuns.toLocaleString()}**`,
        inline: false,
      },
      { name: '🟣 Mithril Powder',  value: `Available: **${mithril.toLocaleString()}**\nSpent: **${mithrilSpent.toLocaleString()}**`, inline: true },
      { name: '💎 Gemstone Powder', value: `Available: **${gemstone.toLocaleString()}**\nSpent: **${gemstoneSpent.toLocaleString()}**`, inline: true },
      { name: '❄️ Glacite Powder',   value: `**${glacite.toLocaleString()}**`, inline: true },
    )
    .setFooter({ text: 'SkyBot v2 • Mining' })
    .setTimestamp();
}

// ── Main Command ──────────────────────────────────────────────────────────────

export default {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View a detailed Hypixel SkyBlock profile (SkyCrypt-style)')
    .addStringOption(o =>
      o.setName('ign').setDescription('Minecraft IGN — leave blank to use linked account').setRequired(false)
    )
    .addStringOption(o =>
      o.setName('page')
       .setDescription('Which page to show')
       .setRequired(false)
       .addChoices(
         { name: 'Overview',  value: 'overview'  },
         { name: 'Skills',    value: 'skills'    },
         { name: 'Dungeons',  value: 'dungeons'  },
         { name: 'Slayers',   value: 'slayers'   },
         { name: 'Mining',    value: 'mining'    },
       )
    ),

  cooldown: 5,

  async execute(interaction, client) {
    await interaction.deferReply();

    const db  = getDb();
    let ign   = interaction.options.getString('ign')?.trim();
    let uuid;
    let page  = interaction.options.getString('page') ?? 'overview';

    // Resolve account
    if (!ign) {
      const linked = db.linkedPlayers?.[interaction.user.id];
      if (!linked) {
        return interaction.editReply({ embeds: [errorEmbed('Not Linked', 'Use `/link <ign>` first, or provide an IGN.')] });
      }
      ({ ign, uuid } = linked);
    }

    try {
      if (!uuid) {
        const mojang = await getUUID(ign);
        ign  = mojang.name;
        uuid = mojang.id;
      }

      // Fetch profile + player data in parallel
      const [profiles, playerData] = await Promise.all([
        getSkyblockProfiles(uuid),
        getPlayerData(uuid).catch(() => null),
      ]);

      if (!profiles?.length) {
        return interaction.editReply({ embeds: [errorEmbed('No Profiles', `**${ign}** has no SkyBlock profiles.`)] });
      }

      // Active profile (selected or first)
      const activeProfile = profiles.find(p => p.selected) ?? profiles[0];
      const member        = activeProfile.members?.[uuid];
      if (!member) {
        return interaction.editReply({ embeds: [errorEmbed('Error', 'Could not read profile member data.')] });
      }

      // ── Calculate all stats ─────────────────────────────────────────
      const farmingCapBoost = member?.jacobs_contest?.perks?.farming_level_cap ?? 0;
      const skills   = calcSkills(member, playerData, farmingCapBoost);
      const dungeons = calcDungeons(member);
      const slayers  = calcSlayers(member);
      const nw       = calcNetworth(member, activeProfile);
      const sb       = calcSkyblockLevel(member);
      const rank     = playerData?.newPackageRank ?? playerData?.packageRank ?? 'NON';
      const profileName = activeProfile.cute_name ?? 'Unknown';

      // ── Build embed for selected page ───────────────────────────────
      function getEmbed(p) {
        switch (p) {
          case 'skills':   return buildSkillsEmbed(ign, uuid, profileName, skills);
          case 'dungeons': return buildDungeonsEmbed(ign, uuid, profileName, dungeons);
          case 'slayers':  return buildSlayerEmbed(ign, uuid, profileName, slayers);
          case 'mining':   return buildMiningEmbed(ign, uuid, profileName, member);
          default:         return buildOverviewEmbed(ign, uuid, profileName, rank, sb, skills, dungeons, slayers, nw);
        }
      }

      // ── Navigation buttons ──────────────────────────────────────────
      function navRow(current) {
        const pages = [
          { id: 'overview',  label: '📊 Overview' },
          { id: 'skills',    label: '🎯 Skills'   },
          { id: 'dungeons',  label: '⚔️ Dungeons' },
          { id: 'slayers',   label: '🗡️ Slayers'  },
          { id: 'mining',    label: '⛏️ Mining'   },
        ];
        const row = new ActionRowBuilder();
        for (const p of pages) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`profile_${p.id}_${uuid}`)
              .setLabel(p.label)
              .setStyle(p.id === current ? ButtonStyle.Primary : ButtonStyle.Secondary)
              .setDisabled(p.id === current)
          );
        }
        return row;
      }

      const msg = await interaction.editReply({
        embeds: [getEmbed(page)],
        components: [navRow(page)],
      });

      // Handle nav button clicks
      const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id && i.customId.startsWith('profile_'),
        time: 5 * 60 * 1000, // 5 min
      });

      collector.on('collect', async i => {
        const parts    = i.customId.split('_');
        const newPage  = parts[1]; // overview | skills | dungeons | slayers | mining
        await i.update({ embeds: [getEmbed(newPage)], components: [navRow(newPage)] });
      });

      collector.on('end', async () => {
        // Disable buttons when expired
        const disabledRow = new ActionRowBuilder();
        const pages = ['overview','skills','dungeons','slayers','mining'];
        for (const p of pages) {
          disabledRow.addComponents(
            new ButtonBuilder()
              .setCustomId(`profile_${p}_expired`)
              .setLabel(p.charAt(0).toUpperCase()+p.slice(1))
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
          );
        }
        await interaction.editReply({ components: [disabledRow] }).catch(() => {});
      });

    } catch (err) {
      console.error('[/profile]', err);
      await interaction.editReply({ embeds: [errorEmbed('Error', err.message)] });
    }
  },
};
