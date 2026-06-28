/**
 * voiceStateUpdate.js — auto-pause TTS when VC is empty
 *
 * If everyone (including bot) leaves the VC, stop TTS to save resources.
 */
import { stopTTS, getTTSState } from '../services/ttsService.js';

export default {
  name: 'voiceStateUpdate',
  async execute(oldState, newState, client) {
    const guildId = newState.guild.id;
    const state = getTTSState(guildId);
    if (!state) return;

    // Only check the bot's own VC
    const botVC = newState.guild.members.me?.voice?.channel;
    if (!botVC) return;
    if (botVC.id !== state.voiceChannelId) return;

    // Count humans in the VC
    const humans = botVC.members.filter(m => !m.user.bot).size;
    if (humans === 0) {
      console.log('[TTS] VC empty — auto-stopping TTS');
      stopTTS(guildId);
    }
  },
};
