// Bedwars Ultimate - Deno Deploy Server
// Deploy this to Deno Deploy. Frontend connects via WebSocket.

interface Vec3 { x: number; y: number; z: number; }

interface Player {
  id: string;
  name: string;
  ws: WebSocket;
  pos: Vec3;
  vel: Vec3;
  health: number;
  maxHealth: number;
  armor: number; // 0=none,1=chain,2=iron,3=diamond
  inventory: InventoryItem[];
  hotbar: (InventoryItem | null)[];
  selectedSlot: number;
  islandId: number;
  bedAlive: boolean;
  alive: boolean;
  clanId: string | null;
  essence: number;
  kills: number;
  bounty: number;
  combatTag: number; // timestamp when combat expires
  lastHit: number;
  loggedIn: boolean;
  savedState: SavedPlayerState | null;
  yaw: number;
  pitch: number;
  iron: number;
  gold: number;
  diamond: number;
  emerald: number;
}

interface SavedPlayerState {
  inventory: InventoryItem[];
  hotbar: (InventoryItem | null)[];
  armor: number;
  essence: number;
  kills: number;
}

interface InventoryItem {
  id: string;
  name: string;
  count: number;
  type: 'block' | 'weapon' | 'tool' | 'armor' | 'utility' | 'special';
  damage?: number;
  defense?: number;
  texture?: string;
  data?: Record<string, unknown>;
}

interface Block {
  x: number; y: number; z: number;
  type: string;
  placedBy: string;
  islandId?: number;
  permanent?: boolean;
}

interface Island {
  id: number;
  center: Vec3;
  playerId: string | null;
  bedPos: Vec3;
  bedAlive: boolean;
  generatorPos: Vec3;
  generatorLevel: number;
  generatorTimer: number;
  shopPos: Vec3;
  upgradeShopPos: Vec3;
  alarmBlocks: Vec3[];
  autoTurrets: AutoTurret[];
}

interface AutoTurret {
  pos: Vec3;
  ammo: number;
  ammoType: 'arrow' | 'fireball';
  lastFired: number;
}

interface Clan {
  id: string;
  name: string;
  members: string[]; // player IDs
  leader: string;
  shieldHp: number;
  maxShieldHp: number;
}

interface DroppedItem {
  id: string;
  item: InventoryItem;
  pos: Vec3;
  vel: Vec3;
  droppedBy: string;
  timestamp: number;
}

interface Projectile {
  id: string;
  type: 'arrow' | 'fireball' | 'tnt' | 'void_hole' | 'world_eater_tnt';
  pos: Vec3;
  vel: Vec3;
  ownerId: string;
  damage: number;
  timestamp: number;
  fuse?: number;
}

interface BountyEntry {
  targetId: string;
  amount: number;
  postedBy: string[];
}

// World state
const players = new Map<string, Player>();
const blocks = new Map<string, Block>(); // key = "x,y,z"
const islands: Island[] = [];
const clans = new Map<string, Clan>();
const droppedItems = new Map<string, DroppedItem>();
const projectiles = new Map<string, Projectile>();
const bountyBoard = new Map<string, BountyEntry>();

// Map constants
const ISLAND_COUNT = 80;
const ISLAND_SPACING = 120;
const ISLANDS_PER_ROW = 10;
const BASE_Y = 64;
const VOID_Y = 0;
const MAX_HEIGHT = 256;
const MAP_RADIUS = 800;
const DIAMOND_ISLAND_POSITIONS: Vec3[] = [];
const EMERALD_ISLAND_POSITIONS: Vec3[] = [];

// Generator timing (ms)
const GEN_RATES = [0, 3000, 2500, 2000, 1500, 1000]; // level 0-5

// Combat tag duration
const COMBAT_TAG_MS = 10000;

// Tick rate
const TICK_MS = 50; // 20 ticks/sec

let tickCount = 0;

function blockKey(x: number, y: number, z: number): string {
  return `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function dist3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function islandCenter(id: number): Vec3 {
  const row = Math.floor(id / ISLANDS_PER_ROW);
  const col = id % ISLANDS_PER_ROW;
  return {
    x: (col - ISLANDS_PER_ROW / 2) * ISLAND_SPACING,
    y: BASE_Y,
    z: (row - ISLANDS_PER_ROW / 2) * ISLAND_SPACING
  };
}

// Initialize islands
function initIslands() {
  for (let i = 0; i < ISLAND_COUNT; i++) {
    const center = islandCenter(i);
    islands.push({
      id: i,
      center,
      playerId: null,
      bedPos: { x: center.x, y: center.y + 1, z: center.z },
      bedAlive: false,
      generatorPos: { x: center.x + 3, y: center.y + 1, z: center.z },
      generatorLevel: 1,
      generatorTimer: 0,
      shopPos: { x: center.x - 3, y: center.y + 1, z: center.z },
      upgradeShopPos: { x: center.x - 3, y: center.y + 1, z: center.z + 2 },
      alarmBlocks: [],
      autoTurrets: []
    });

    // Place base island blocks
    for (let bx = -5; bx <= 5; bx++) {
      for (let bz = -5; bz <= 5; bz++) {
        if (bx * bx + bz * bz <= 30) {
          placeBlockPermanent(center.x + bx, center.y, center.z + bz, 'wool_white', i);
        }
      }
    }
  }

  // Diamond islands - between player islands
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const r = ISLAND_SPACING * 3;
    DIAMOND_ISLAND_POSITIONS.push({
      x: Math.round(Math.cos(angle) * r),
      y: BASE_Y,
      z: Math.round(Math.sin(angle) * r)
    });
    // Place diamond island blocks
    const dp = DIAMOND_ISLAND_POSITIONS[i];
    for (let bx = -4; bx <= 4; bx++) {
      for (let bz = -4; bz <= 4; bz++) {
        if (bx * bx + bz * bz <= 20) {
          placeBlockPermanent(dp.x + bx, dp.y, dp.z + bz, 'diamond_block', -1);
        }
      }
    }
  }

  // Emerald islands - center
  for (let i = 0; i < 2; i++) {
    EMERALD_ISLAND_POSITIONS.push({
      x: i === 0 ? -15 : 15,
      y: BASE_Y,
      z: 0
    });
    const ep = EMERALD_ISLAND_POSITIONS[i];
    for (let bx = -5; bx <= 5; bx++) {
      for (let bz = -5; bz <= 5; bz++) {
        if (bx * bx + bz * bz <= 28) {
          placeBlockPermanent(ep.x + bx, ep.y, ep.z + bz, 'emerald_block', -1);
        }
      }
    }
  }
}

function placeBlockPermanent(x: number, y: number, z: number, type: string, islandId: number) {
  blocks.set(blockKey(x, y, z), { x, y, z, type, placedBy: 'world', islandId, permanent: true });
}

function broadcast(msg: unknown, excludeId?: string) {
  const json = JSON.stringify(msg);
  for (const [id, p] of players) {
    if (id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
      try { p.ws.send(json); } catch (_) { /* ignore */ }
    }
  }
}

function send(playerId: string, msg: unknown) {
  const p = players.get(playerId);
  if (p && p.ws.readyState === WebSocket.OPEN) {
    try { p.ws.send(JSON.stringify(msg)); } catch (_) { /* ignore */ }
  }
}

function getPublicPlayerData(p: Player) {
  return {
    id: p.id,
    name: p.name,
    pos: p.pos,
    yaw: p.yaw,
    pitch: p.pitch,
    health: p.health,
    maxHealth: p.maxHealth,
    armor: p.armor,
    alive: p.alive,
    islandId: p.islandId,
    bedAlive: p.bedAlive,
    clanId: p.clanId,
    kills: p.kills,
    bounty: p.bounty,
    combatTag: p.combatTag,
    selectedSlot: p.selectedSlot,
  };
}

function findFreeIsland(): number {
  for (let i = 0; i < islands.length; i++) {
    if (!islands[i].playerId) return i;
  }
  return -1;
}

function spawnPlayer(p: Player) {
  const island = islands[p.islandId];
  p.pos = { x: island.center.x, y: island.center.y + 2, z: island.center.z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.health = p.maxHealth;
  p.alive = true;

  // Restore saved state if bed is alive
  if (p.savedState && p.bedAlive) {
    p.inventory = p.savedState.inventory;
    p.hotbar = p.savedState.hotbar;
    p.armor = p.savedState.armor;
  } else {
    // Fresh spawn
    p.inventory = [];
    p.hotbar = [null, null, null, null, null, null, null, null, null];
    p.armor = 0;
  }

  send(p.id, {
    type: 'spawn',
    pos: p.pos,
    inventory: p.inventory,
    hotbar: p.hotbar,
    armor: p.armor,
    health: p.health,
    island: serializeIsland(island),
    iron: p.iron,
    gold: p.gold,
    diamond: p.diamond,
    emerald: p.emerald,
  });
}

function serializeIsland(island: Island) {
  return {
    id: island.id,
    center: island.center,
    bedPos: island.bedPos,
    bedAlive: island.bedAlive,
    generatorPos: island.generatorPos,
    generatorLevel: island.generatorLevel,
    shopPos: island.shopPos,
  };
}

function killPlayer(p: Player, killerId?: string) {
  if (!p.alive) return;
  p.alive = false;
  p.combatTag = 0;

  // Drop inventory items
  const drops: DroppedItem[] = [];
  const allItems = [...p.inventory, ...p.hotbar.filter(Boolean)] as InventoryItem[];
  for (const item of allItems) {
    if (!item) continue;
    const dropId = uid();
    const drop: DroppedItem = {
      id: dropId,
      item,
      pos: { ...p.pos, y: p.pos.y + 0.5 },
      vel: { x: (Math.random() - 0.5) * 0.3, y: 0.2, z: (Math.random() - 0.5) * 0.3 },
      droppedBy: p.id,
      timestamp: Date.now()
    };
    droppedItems.set(dropId, drop);
    drops.push(drop);
  }

  // Drop currencies
  if (p.iron > 0) { const d = makeCurrencyDrop(p, 'iron', p.iron); drops.push(d); p.iron = 0; }
  if (p.gold > 0) { const d = makeCurrencyDrop(p, 'gold', p.gold); drops.push(d); p.gold = 0; }

  if (killerId) {
    const killer = players.get(killerId);
    if (killer) {
      killer.kills++;
      // Bounty claim
      const bounty = bountyBoard.get(p.id);
      if (bounty) {
        killer.gold += bounty.amount;
        broadcast({ type: 'bounty_claimed', killerName: killer.name, targetName: p.name, amount: bounty.amount });
        bountyBoard.delete(p.id);
      }
    }
  }

  if (!p.bedAlive) {
    // Final kill - remove from island
    const island = islands[p.islandId];
    island.playerId = null;
    broadcast({ type: 'final_kill', playerId: p.id, playerName: p.name, killerName: killerId ? players.get(killerId)?.name : undefined });
    players.delete(p.id);
    checkWinCondition();
  } else {
    // Respawn after 5 seconds
    broadcast({ type: 'player_died', playerId: p.id, killerName: killerId ? players.get(killerId)?.name : undefined });
    setTimeout(() => {
      if (players.has(p.id) && p.bedAlive) {
        spawnPlayer(p);
        broadcast({ type: 'player_spawned', player: getPublicPlayerData(p) });
      }
    }, 5000);
  }

  broadcast({ type: 'player_killed', playerId: p.id, drops: drops.map(d => ({ id: d.id, item: d.item, pos: d.pos })) });
}

function makeCurrencyDrop(p: Player, type: string, count: number): DroppedItem {
  const dropId = uid();
  const drop: DroppedItem = {
    id: dropId,
    item: { id: type, name: type.charAt(0).toUpperCase() + type.slice(1), count, type: 'utility' },
    pos: { ...p.pos, y: p.pos.y + 0.5 },
    vel: { x: (Math.random() - 0.5) * 0.2, y: 0.15, z: (Math.random() - 0.5) * 0.2 },
    droppedBy: p.id,
    timestamp: Date.now()
  };
  droppedItems.set(dropId, drop);
  return drop;
}

function checkWinCondition() {
  const alive = [...players.values()].filter(p => p.bedAlive || p.alive);
  if (alive.length === 1) {
    const winner = alive[0];
    broadcast({ type: 'game_over', winnerId: winner.id, winnerName: winner.name });
    // Reset after 30 seconds
    setTimeout(resetGame, 30000);
  } else if (alive.length === 0) {
    broadcast({ type: 'game_over', winnerId: null, winnerName: 'Nobody' });
    setTimeout(resetGame, 30000);
  }
}

function resetGame() {
  players.clear();
  // Clear non-permanent blocks
  for (const [key, block] of blocks) {
    if (!block.permanent) blocks.delete(key);
  }
  clans.clear();
  droppedItems.clear();
  projectiles.clear();
  bountyBoard.clear();
  for (const island of islands) {
    island.playerId = null;
    island.bedAlive = false;
    island.generatorLevel = 1;
    island.generatorTimer = 0;
    island.alarmBlocks = [];
    island.autoTurrets = [];
  }
  broadcast({ type: 'game_reset' });
}

function applyDamage(target: Player, damage: number, attackerId: string) {
  // Armor reduction
  const armorReduction = [0, 0.15, 0.30, 0.50];
  const reduced = damage * (1 - armorReduction[target.armor]);
  target.health = Math.max(0, target.health - reduced);

  // Combat tag both players
  const now = Date.now();
  target.combatTag = now + COMBAT_TAG_MS;
  const attacker = players.get(attackerId);
  if (attacker) attacker.combatTag = now + COMBAT_TAG_MS;

  broadcast({
    type: 'player_damaged',
    targetId: target.id,
    health: target.health,
    damage: reduced,
    attackerId
  });

  if (target.health <= 0) {
    killPlayer(target, attackerId);
  }
}

// Shop items catalog
const SHOP_ITEMS: Record<string, { cost: number; currency: string; item: InventoryItem; count: number }> = {
  wool: { cost: 4, currency: 'iron', count: 16, item: { id: 'wool', name: 'Wool', count: 16, type: 'block', texture: 'wool' } },
  planks: { cost: 4, currency: 'iron', count: 8, item: { id: 'planks', name: 'Wood Planks', count: 8, type: 'block', texture: 'planks' } },
  glass: { cost: 12, currency: 'iron', count: 4, item: { id: 'glass', name: 'Hardened Glass', count: 4, type: 'block', texture: 'glass' } },
  sandstone: { cost: 24, currency: 'iron', count: 8, item: { id: 'sandstone', name: 'Sandstone', count: 8, type: 'block', texture: 'sandstone' } },
  endstone: { cost: 24, currency: 'iron', count: 4, item: { id: 'endstone', name: 'End Stone', count: 4, type: 'block', texture: 'endstone' } },
  obsidian: { cost: 4, currency: 'emerald', count: 4, item: { id: 'obsidian', name: 'Obsidian', count: 4, type: 'block', texture: 'obsidian' } },

  // Tools
  wooden_pickaxe: { cost: 10, currency: 'iron', count: 1, item: { id: 'wooden_pickaxe', name: 'Wooden Pickaxe', count: 1, type: 'tool', damage: 2, texture: 'wooden_pickaxe' } },
  stone_pickaxe: { cost: 20, currency: 'iron', count: 1, item: { id: 'stone_pickaxe', name: 'Stone Pickaxe', count: 1, type: 'tool', damage: 3, texture: 'stone_pickaxe' } },
  iron_pickaxe: { cost: 6, currency: 'gold', count: 1, item: { id: 'iron_pickaxe', name: 'Iron Pickaxe', count: 1, type: 'tool', damage: 4, texture: 'iron_pickaxe' } },
  diamond_pickaxe: { cost: 3, currency: 'emerald', count: 1, item: { id: 'diamond_pickaxe', name: 'Diamond Pickaxe', count: 1, type: 'tool', damage: 6, texture: 'diamond_pickaxe' } },
  shears: { cost: 20, currency: 'iron', count: 1, item: { id: 'shears', name: 'Shears', count: 1, type: 'tool', damage: 1, texture: 'shears' } },

  // Weapons
  wooden_sword: { cost: 0, currency: 'iron', count: 1, item: { id: 'wooden_sword', name: 'Wooden Sword', count: 1, type: 'weapon', damage: 4, texture: 'wooden_sword' } },
  stone_sword: { cost: 10, currency: 'iron', count: 1, item: { id: 'stone_sword', name: 'Stone Sword', count: 1, type: 'weapon', damage: 5, texture: 'stone_sword' } },
  iron_sword: { cost: 7, currency: 'gold', count: 1, item: { id: 'iron_sword', name: 'Iron Sword', count: 1, type: 'weapon', damage: 6, texture: 'iron_sword' } },
  diamond_sword: { cost: 4, currency: 'emerald', count: 1, item: { id: 'diamond_sword', name: 'Diamond Sword', count: 1, type: 'weapon', damage: 8, texture: 'diamond_sword' } },
  bow: { cost: 12, currency: 'gold', count: 1, item: { id: 'bow', name: 'Bow', count: 1, type: 'weapon', damage: 5, texture: 'bow' } },
  arrows: { cost: 2, currency: 'gold', count: 8, item: { id: 'arrows', name: 'Arrows', count: 8, type: 'utility', texture: 'arrow' } },

  // Armor
  chainmail_armor: { cost: 40, currency: 'iron', count: 1, item: { id: 'chainmail_armor', name: 'Chainmail Armor', count: 1, type: 'armor', defense: 1, texture: 'chainmail' } },
  iron_armor: { cost: 12, currency: 'gold', count: 1, item: { id: 'iron_armor', name: 'Iron Armor', count: 1, type: 'armor', defense: 2, texture: 'iron_armor' } },
  diamond_armor: { cost: 6, currency: 'emerald', count: 1, item: { id: 'diamond_armor', name: 'Diamond Armor', count: 1, type: 'armor', defense: 3, texture: 'diamond_armor' } },

  // Utilities
  tnt: { cost: 8, currency: 'gold', count: 1, item: { id: 'tnt', name: 'TNT', count: 1, type: 'utility', damage: 10, texture: 'tnt' } },
  fireball: { cost: 40, currency: 'iron', count: 1, item: { id: 'fireball', name: 'Fireball', count: 1, type: 'utility', damage: 8, texture: 'fire_charge' } },
  ender_pearl: { cost: 4, currency: 'emerald', count: 1, item: { id: 'ender_pearl', name: 'Ender Pearl', count: 1, type: 'utility', texture: 'ender_pearl' } },
  water_bucket: { cost: 6, currency: 'gold', count: 1, item: { id: 'water_bucket', name: 'Water Bucket', count: 1, type: 'utility', texture: 'water_bucket' } },
  golden_apple: { cost: 3, currency: 'gold', count: 1, item: { id: 'golden_apple', name: 'Golden Apple', count: 1, type: 'utility', texture: 'golden_apple' } },
  speed_potion: { cost: 2, currency: 'gold', count: 1, item: { id: 'speed_potion', name: 'Speed Potion', count: 1, type: 'utility', texture: 'potion' } },
  invisibility: { cost: 4, currency: 'gold', count: 1, item: { id: 'invisibility', name: 'Invisibility', count: 1, type: 'utility', texture: 'invis_potion' } },
  grapple_hook: { cost: 5, currency: 'emerald', count: 1, item: { id: 'grapple_hook', name: 'Grapple Hook', count: 1, type: 'utility', texture: 'fishing_rod' } },
  dream_defender: { cost: 120, currency: 'iron', count: 1, item: { id: 'dream_defender', name: 'Dream Defender', count: 1, type: 'utility', texture: 'iron_golem' } },
  alarm_block: { cost: 3, currency: 'gold', count: 1, item: { id: 'alarm_block', name: 'Alarm Block', count: 1, type: 'utility', texture: 'redstone_lamp' } },

  // ULTIMATE items
  world_eater_tnt: { cost: 8, currency: 'emerald', count: 1, item: { id: 'world_eater_tnt', name: '⚠ World-Eater TNT', count: 1, type: 'special', damage: 15, texture: 'tnt', data: { worldEater: true } } },
  orbital_strike: { cost: 12, currency: 'emerald', count: 1, item: { id: 'orbital_strike', name: '☄ Orbital Strike Beacon', count: 1, type: 'special', damage: 50, texture: 'beacon' } },
  void_hole: { cost: 6, currency: 'emerald', count: 1, item: { id: 'void_hole', name: '🕳 Void-Hole Grenade', count: 1, type: 'special', damage: 0, texture: 'ender_pearl' } },
  kinetic_shield: { cost: 10, currency: 'emerald', count: 4, item: { id: 'kinetic_shield', name: '🛡 Kinetic Shield', count: 4, type: 'block', texture: 'iron_block' } },
  nanobot_cloud: { cost: 8, currency: 'emerald', count: 2, item: { id: 'nanobot_cloud', name: '🤖 Nanobot Cloud', count: 2, type: 'block', texture: 'redstone_block' } },
  auto_turret: { cost: 6, currency: 'emerald', count: 1, item: { id: 'auto_turret', name: '🎯 Auto-Turret Block', count: 1, type: 'special', texture: 'dispenser' } },
  spy_drone: { cost: 4, currency: 'emerald', count: 1, item: { id: 'spy_drone', name: '🚁 Spy Drone', count: 1, type: 'special', texture: 'compass' } },
};

const GENERATOR_UPGRADES: { cost: number; currency: string; level: number; name: string }[] = [
  { cost: 4, currency: 'diamond', level: 2, name: 'Generator II' },
  { cost: 8, currency: 'diamond', level: 3, name: 'Generator III' },
  { cost: 16, currency: 'diamond', level: 4, name: 'Generator IV' },
  { cost: 24, currency: 'diamond', level: 5, name: 'Generator V' },
];

function handleMessage(playerId: string, raw: string) {
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(raw); } catch { return; }

  const p = players.get(playerId);
  if (!p) return;

  switch (msg.type) {
    case 'move': {
      if (!p.alive) return;
      const pos = msg.pos as Vec3;
      const yaw = msg.yaw as number;
      const pitch = msg.pitch as number;

      // Validate position (anti-cheat: max speed ~20 blocks/tick)
      const speed = dist3(p.pos, pos);
      if (speed > 2) return; // Too fast, reject

      // Void check
      if (pos.y < VOID_Y) {
        killPlayer(p, undefined);
        return;
      }

      p.pos = pos;
      p.yaw = yaw ?? p.yaw;
      p.pitch = pitch ?? p.pitch;

      // Check generator proximity for currency pickup
      const island = islands[p.islandId];
      checkResourcePickup(p, island);

      // Check diamond/emerald island proximity
      checkMidResourcePickup(p);

      // Check dropped item pickup
      checkItemPickup(p);

      // Check alarm blocks
      checkAlarmTrigger(p);

      broadcast({
        type: 'player_move',
        id: p.id,
        pos: p.pos,
        yaw: p.yaw,
        pitch: p.pitch,
        vel: p.vel,
      }, playerId);
      break;
    }

    case 'place_block': {
      if (!p.alive) return;
      const bpos = msg.pos as Vec3;
      const blockType = msg.blockType as string;

      // Validate island ownership
      const nearestIsland = getNearestIsland(bpos);
      if (nearestIsland && nearestIsland.playerId === null && nearestIsland.id !== p.islandId) return;

      // Check height limit
      if (bpos.y > MAX_HEIGHT || bpos.y < 0) return;

      // Check if player has the block
      const hasBlock = removeFromInventory(p, blockType, 1);
      if (!hasBlock) return;

      // Special block placement
      if (blockType === 'alarm_block') {
        islands[p.islandId].alarmBlocks.push(bpos);
      }
      if (blockType === 'auto_turret') {
        islands[p.islandId].autoTurrets.push({ pos: bpos, ammo: 16, ammoType: 'arrow', lastFired: 0 });
      }

      const block: Block = { x: bpos.x, y: bpos.y, z: bpos.z, type: blockType, placedBy: playerId };
      blocks.set(blockKey(bpos.x, bpos.y, bpos.z), block);

      broadcast({ type: 'block_placed', pos: bpos, blockType, placedBy: playerId });
      send(playerId, { type: 'inventory_update', inventory: p.inventory, hotbar: p.hotbar });
      break;
    }

    case 'break_block': {
      if (!p.alive) return;
      const bpos = msg.pos as Vec3;
      const key = blockKey(bpos.x, bpos.y, bpos.z);
      const block = blocks.get(key);
      if (!block) return;
      if (block.permanent) return; // Can't break permanent island blocks (only bed defense)

      // Check if it's a bed
      for (const island of islands) {
        const bp = island.bedPos;
        if (Math.round(bp.x) === Math.round(bpos.x) &&
          Math.round(bp.y) === Math.round(bpos.y) &&
          Math.round(bp.z) === Math.round(bpos.z)) {
          if (island.id === p.islandId) return; // Can't break own bed
          destroyBed(island, p);
          return;
        }
      }

      // Remove alarm block if it was one
      if (block.type === 'alarm_block') {
        for (const island of islands) {
          island.alarmBlocks = island.alarmBlocks.filter(a =>
            !(Math.round(a.x) === Math.round(bpos.x) && Math.round(a.z) === Math.round(bpos.z)));
        }
      }

      blocks.delete(key);
      broadcast({ type: 'block_broken', pos: bpos, brokenBy: playerId });
      break;
    }

    case 'attack': {
      if (!p.alive) return;
      const targetId = msg.targetId as string;
      const target = players.get(targetId);
      if (!target || !target.alive) return;
      if (dist3(p.pos, target.pos) > 4) return; // Max melee range

      // Get held item damage
      const heldItem = p.hotbar[p.selectedSlot];
      let damage = 3; // fist damage
      if (heldItem && heldItem.type === 'weapon') {
        damage = heldItem.damage ?? 4;
      }

      applyDamage(target, damage, p.id);
      break;
    }

    case 'shoot': {
      if (!p.alive) return;
      const heldItem = p.hotbar[p.selectedSlot];
      if (!heldItem || heldItem.id !== 'bow') return;

      // Check arrows
      const arrows = removeFromInventory(p, 'arrows', 1);
      if (!arrows) return;

      const projId = uid();
      const dir = msg.dir as Vec3;
      const proj: Projectile = {
        id: projId,
        type: 'arrow',
        pos: { ...p.pos, y: p.pos.y + 1.5 },
        vel: { x: dir.x * 0.8, y: dir.y * 0.8, z: dir.z * 0.8 },
        ownerId: p.id,
        damage: 5,
        timestamp: Date.now()
      };
      projectiles.set(projId, proj);
      broadcast({ type: 'projectile_spawned', projectile: { id: projId, type: 'arrow', pos: proj.pos, vel: proj.vel, ownerId: p.id } });
      send(playerId, { type: 'inventory_update', inventory: p.inventory, hotbar: p.hotbar });
      break;
    }

    case 'throw_item': {
      if (!p.alive) return;
      const itemId = msg.itemId as string;
      const dir = msg.dir as Vec3;

      // Find item in inventory
      const item = findAndRemoveItem(p, itemId);
      if (!item) return;

      handleThrownItem(p, item, dir);
      send(playerId, { type: 'inventory_update', inventory: p.inventory, hotbar: p.hotbar });
      break;
    }

    case 'use_item': {
      if (!p.alive) return;
      const heldItem = p.hotbar[p.selectedSlot];
      if (!heldItem) return;
      handleUseItem(p, heldItem);
      break;
    }

    case 'select_slot': {
      p.selectedSlot = Math.max(0, Math.min(8, msg.slot as number));
      break;
    }

    case 'drop_item': {
      if (!p.alive) return;
      const slotType = msg.slotType as string;
      const slotIndex = msg.slotIndex as number;
      let item: InventoryItem | null = null;

      if (slotType === 'hotbar') {
        item = p.hotbar[slotIndex];
        p.hotbar[slotIndex] = null;
      } else {
        item = p.inventory[slotIndex] ?? null;
        p.inventory.splice(slotIndex, 1);
      }

      if (!item) return;

      const dropId = uid();
      const drop: DroppedItem = {
        id: dropId,
        item,
        pos: { ...p.pos, y: p.pos.y + 1 },
        vel: { x: Math.sin(p.yaw) * 0.3, y: 0.2, z: Math.cos(p.yaw) * 0.3 },
        droppedBy: p.id,
        timestamp: Date.now()
      };
      droppedItems.set(dropId, drop);
      broadcast({ type: 'item_dropped', drop: { id: dropId, item, pos: drop.pos } });
      send(playerId, { type: 'inventory_update', inventory: p.inventory, hotbar: p.hotbar });
      break;
    }

    case 'buy_item': {
      const shopItemKey = msg.itemKey as string;
      const shopItem = SHOP_ITEMS[shopItemKey];
      if (!shopItem) return;

      // Check currency
      const cost = shopItem.cost;
      const curr = shopItem.currency as 'iron' | 'gold' | 'diamond' | 'emerald';
      if (p[curr] < cost) {
        send(p.id, { type: 'shop_error', message: `Need ${cost} ${curr}` });
        return;
      }

      p[curr] -= cost;
      const newItem = { ...shopItem.item, count: shopItem.count };

      if (newItem.type === 'armor') {
        p.armor = newItem.defense ?? 0;
        send(p.id, { type: 'armor_update', armor: p.armor });
      } else {
        giveItem(p, newItem);
      }

      send(p.id, {
        type: 'purchase_success',
        item: newItem,
        currency: curr,
        remaining: p[curr],
        inventory: p.inventory,
        hotbar: p.hotbar
      });
      break;
    }

    case 'upgrade_generator': {
      const island = islands[p.islandId];
      if (island.playerId !== p.id) return;
      const upgrade = GENERATOR_UPGRADES.find(u => u.level === island.generatorLevel + 1);
      if (!upgrade) return;
      if (p.diamond < upgrade.cost) {
        send(p.id, { type: 'shop_error', message: `Need ${upgrade.cost} diamond` });
        return;
      }
      p.diamond -= upgrade.cost;
      island.generatorLevel = upgrade.level;
      send(p.id, { type: 'generator_upgraded', level: island.generatorLevel, diamond: p.diamond });
      break;
    }

    case 'create_clan': {
      if (p.clanId) return;
      const clanName = (msg.name as string)?.slice(0, 20).replace(/[^a-zA-Z0-9 _-]/g, '');
      if (!clanName) return;
      const clanId = uid();
      const clan: Clan = {
        id: clanId,
        name: clanName,
        members: [p.id],
        leader: p.id,
        shieldHp: 100,
        maxShieldHp: 100,
      };
      clans.set(clanId, clan);
      p.clanId = clanId;
      send(p.id, { type: 'clan_created', clan });
      broadcast({ type: 'clan_update', clan });
      break;
    }

    case 'invite_clan': {
      if (!p.clanId) return;
      const clan = clans.get(p.clanId);
      if (!clan || clan.leader !== p.id) return;
      const targetName = msg.playerName as string;
      const target = [...players.values()].find(pl => pl.name === targetName);
      if (!target || target.clanId) return;
      send(target.id, { type: 'clan_invite', clanId: p.clanId, clanName: clan.name, fromName: p.name });
      break;
    }

    case 'accept_clan': {
      if (p.clanId) return;
      const clanId = msg.clanId as string;
      const clan = clans.get(clanId);
      if (!clan) return;
      clan.members.push(p.id);
      p.clanId = clanId;
      // Link bed shields
      clan.shieldHp += 50;
      clan.maxShieldHp += 50;
      send(p.id, { type: 'clan_joined', clan });
      broadcast({ type: 'clan_update', clan });
      break;
    }

    case 'post_bounty': {
      const targetName = msg.targetName as string;
      const amount = Math.min(msg.amount as number, p.gold);
      if (amount <= 0) return;
      const target = [...players.values()].find(pl => pl.name === targetName);
      if (!target) return;
      p.gold -= amount;
      const existing = bountyBoard.get(target.id);
      if (existing) {
        existing.amount += amount;
        existing.postedBy.push(p.id);
      } else {
        bountyBoard.set(target.id, { targetId: target.id, amount, postedBy: [p.id] });
      }
      target.bounty = (bountyBoard.get(target.id)?.amount ?? 0);
      broadcast({ type: 'bounty_posted', targetName, amount, posterName: p.name, totalBounty: target.bounty });
      send(p.id, { type: 'gold_update', gold: p.gold });
      break;
    }

    case 'logout': {
      handlePlayerLogout(p);
      break;
    }

    case 'chat': {
      const msg2 = (msg.message as string)?.slice(0, 200);
      if (!msg2) return;
      broadcast({ type: 'chat', playerId: p.id, playerName: p.name, message: msg2, clanId: p.clanId });
      break;
    }

    case 'essence_upgrade': {
      const upgradeType = msg.upgradeType as string;
      handleEssenceUpgrade(p, upgradeType);
      break;
    }
  }
}

function handlePlayerLogout(p: Player) {
  const now = Date.now();
  if (p.combatTag > now) {
    // Combat logging - kill player
    killPlayer(p, undefined);
    broadcast({ type: 'chat', playerId: 'system', playerName: 'System', message: `${p.name} combat-logged and died!`, clanId: null });
  } else {
    // Safe logout - save state
    if (p.bedAlive) {
      p.savedState = {
        inventory: p.inventory,
        hotbar: p.hotbar,
        armor: p.armor,
        essence: p.essence,
        kills: p.kills,
      };
    }
    p.loggedIn = false;
    p.alive = false;
    broadcast({ type: 'player_offline', playerId: p.id });
  }
}

function handleThrownItem(p: Player, item: InventoryItem, dir: Vec3) {
  const projId = uid();

  if (item.id === 'tnt' || item.id === 'world_eater_tnt') {
    const proj: Projectile = {
      id: projId,
      type: item.id === 'world_eater_tnt' ? 'world_eater_tnt' : 'tnt',
      pos: { ...p.pos, y: p.pos.y + 1.5 },
      vel: { x: dir.x * 0.5, y: dir.y * 0.5 + 0.3, z: dir.z * 0.5 },
      ownerId: p.id,
      damage: item.damage ?? 10,
      timestamp: Date.now(),
      fuse: 3000 // 3 second fuse
    };
    projectiles.set(projId, proj);
    broadcast({ type: 'projectile_spawned', projectile: { id: projId, type: proj.type, pos: proj.pos, vel: proj.vel, ownerId: p.id, fuse: proj.fuse } });
    return;
  }

  if (item.id === 'fireball') {
    const proj: Projectile = {
      id: projId,
      type: 'fireball',
      pos: { ...p.pos, y: p.pos.y + 1.5 },
      vel: { x: dir.x * 1.2, y: dir.y * 1.2, z: dir.z * 1.2 },
      ownerId: p.id,
      damage: 8,
      timestamp: Date.now()
    };
    projectiles.set(projId, proj);
    broadcast({ type: 'projectile_spawned', projectile: { id: projId, type: 'fireball', pos: proj.pos, vel: proj.vel, ownerId: p.id } });
    return;
  }

  if (item.id === 'void_hole') {
    broadcast({ type: 'void_hole', pos: { ...p.pos, y: p.pos.y + 1.5 }, radius: 6, ownerId: p.id });
    // Suck nearby players
    for (const [, target] of players) {
      if (target.id === p.id || !target.alive) continue;
      if (dist3(p.pos, target.pos) < 6) {
        applyDamage(target, 8, p.id);
        target.pos.y -= 5; // Drag down
        broadcast({ type: 'player_move', id: target.id, pos: target.pos, yaw: target.yaw, pitch: target.pitch });
      }
    }
    return;
  }

  if (item.id === 'ender_pearl') {
    // Teleport to aimed location
    const dest = {
      x: p.pos.x + dir.x * 20,
      y: p.pos.y + dir.y * 20,
      z: p.pos.z + dir.z * 20
    };
    applyDamage(p, 5, p.id); // Pearl damage
    p.pos = dest;
    send(p.id, { type: 'teleport', pos: dest });
    broadcast({ type: 'player_move', id: p.id, pos: p.pos, yaw: p.yaw, pitch: p.pitch }, p.id);
    return;
  }

  if (item.id === 'orbital_strike') {
    const strikePos = {
      x: p.pos.x + dir.x * 30,
      y: BASE_Y + 20,
      z: p.pos.z + dir.z * 30,
    };
    broadcast({ type: 'orbital_strike', pos: strikePos, ownerId: p.id });
    // Delete column of blocks
    setTimeout(() => {
      for (let y = 0; y <= MAX_HEIGHT; y++) {
        for (let bx = -2; bx <= 2; bx++) {
          for (let bz = -2; bz <= 2; bz++) {
            const key = blockKey(strikePos.x + bx, y, strikePos.z + bz);
            if (blocks.has(key)) {
              const b = blocks.get(key)!;
              if (!b.permanent) {
                blocks.delete(key);
              }
            }
          }
        }
      }
      // Damage nearby players
      for (const [, target] of players) {
        if (!target.alive) continue;
        if (Math.abs(target.pos.x - strikePos.x) < 5 && Math.abs(target.pos.z - strikePos.z) < 5) {
          applyDamage(target, 50, p.id);
        }
      }
      broadcast({ type: 'orbital_strike_hit', pos: strikePos });
    }, 2000);
    return;
  }

  if (item.id === 'golden_apple') {
    p.health = Math.min(p.maxHealth, p.health + 8);
    broadcast({ type: 'player_healed', playerId: p.id, health: p.health });
    return;
  }
}

function handleUseItem(p: Player, item: InventoryItem) {
  if (item.id === 'golden_apple') {
    removeFromInventory(p, 'golden_apple', 1);
    p.health = Math.min(p.maxHealth, p.health + 8);
    send(p.id, { type: 'health_update', health: p.health });
    broadcast({ type: 'player_healed', playerId: p.id, health: p.health });
    send(p.id, { type: 'inventory_update', inventory: p.inventory, hotbar: p.hotbar });
    return;
  }

  if (item.id === 'speed_potion') {
    removeFromInventory(p, 'speed_potion', 1);
    send(p.id, { type: 'effect', effect: 'speed', duration: 15000 });
    send(p.id, { type: 'inventory_update', inventory: p.inventory, hotbar: p.hotbar });
    return;
  }

  if (item.id === 'invisibility') {
    removeFromInventory(p, 'invisibility', 1);
    send(p.id, { type: 'effect', effect: 'invisibility', duration: 20000 });
    broadcast({ type: 'player_invisible', playerId: p.id, duration: 20000 }, p.id);
    send(p.id, { type: 'inventory_update', inventory: p.inventory, hotbar: p.hotbar });
    return;
  }

  if (item.id === 'water_bucket') {
    // Place water at feet
    const key = blockKey(p.pos.x, p.pos.y - 1, p.pos.z);
    blocks.set(key, { x: Math.round(p.pos.x), y: Math.round(p.pos.y) - 1, z: Math.round(p.pos.z), type: 'water', placedBy: p.id });
    broadcast({ type: 'block_placed', pos: { x: Math.round(p.pos.x), y: Math.round(p.pos.y) - 1, z: Math.round(p.pos.z) }, blockType: 'water', placedBy: p.id });
    removeFromInventory(p, 'water_bucket', 1);
    send(p.id, { type: 'inventory_update', inventory: p.inventory, hotbar: p.hotbar });
    return;
  }
}

function handleEssenceUpgrade(p: Player, upgradeType: string) {
  const costs: Record<string, number> = {
    movement: 50,
    max_health: 75,
    gen_boost: 100,
    damage_boost: 80,
  };
  const cost = costs[upgradeType];
  if (!cost || p.essence < cost) {
    send(p.id, { type: 'shop_error', message: `Need ${cost} essence` });
    return;
  }
  p.essence -= cost;
  send(p.id, { type: 'essence_upgrade_applied', upgradeType, essence: p.essence });
  if (upgradeType === 'max_health') {
    p.maxHealth += 4;
    p.health = Math.min(p.health, p.maxHealth);
  }
}

function destroyBed(island: Island, destroyer: Player) {
  island.bedAlive = false;
  const islandOwner = island.playerId ? players.get(island.playerId) : null;
  if (islandOwner) {
    islandOwner.bedAlive = false;
    islandOwner.savedState = null; // Clear saved state
    send(islandOwner.id, { type: 'bed_destroyed', destroyedBy: destroyer.name });
  }
  destroyer.essence += 25;
  send(destroyer.id, { type: 'essence_gained', amount: 25, total: destroyer.essence });
  broadcast({
    type: 'bed_exploded',
    islandId: island.id,
    destroyerName: destroyer.name,
    ownerName: islandOwner?.name
  });

  // Remove island's bed block
  const key = blockKey(island.bedPos.x, island.bedPos.y, island.bedPos.z);
  blocks.delete(key);
  broadcast({ type: 'block_broken', pos: island.bedPos, brokenBy: destroyer.id });
}

function worldEaterExplosion(pos: Vec3, blockType: string, depth: number, ownerId: string) {
  if (depth <= 0) return;
  const key = blockKey(pos.x, pos.y, pos.z);
  if (!blocks.has(key)) return;
  const block = blocks.get(key)!;
  if (block.type !== blockType || block.permanent) return;

  blocks.delete(key);
  broadcast({ type: 'block_broken', pos, brokenBy: ownerId });

  // Spread to neighbors
  const neighbors = [
    { x: pos.x + 1, y: pos.y, z: pos.z },
    { x: pos.x - 1, y: pos.y, z: pos.z },
    { x: pos.x, y: pos.y + 1, z: pos.z },
    { x: pos.x, y: pos.y - 1, z: pos.z },
    { x: pos.x, y: pos.y, z: pos.z + 1 },
    { x: pos.x, y: pos.y, z: pos.z - 1 },
  ];
  for (const n of neighbors) {
    worldEaterExplosion(n, blockType, depth - 1, ownerId);
  }
}

function explodeTNT(pos: Vec3, radius: number, ownerId: string, isWorldEater = false) {
  if (isWorldEater) {
    const key = blockKey(pos.x, pos.y, pos.z);
    const block = blocks.get(key);
    if (block) worldEaterExplosion(pos, block.type, 50, ownerId);
    else {
      // Try adjacent blocks
      const neighbors = [
        { x: pos.x + 1, y: pos.y, z: pos.z },
        { x: pos.x - 1, y: pos.y, z: pos.z },
        { x: pos.x, y: pos.y, z: pos.z + 1 },
        { x: pos.x, y: pos.y, z: pos.z - 1 },
      ];
      for (const n of neighbors) {
        const nKey = blockKey(n.x, n.y, n.z);
        const nb = blocks.get(nKey);
        if (nb && !nb.permanent) {
          worldEaterExplosion(n, nb.type, 50, ownerId);
          break;
        }
      }
    }
  } else {
    // Normal explosion
    const deletedBlocks: Vec3[] = [];
    for (let bx = -radius; bx <= radius; bx++) {
      for (let by = -radius; by <= radius; by++) {
        for (let bz = -radius; bz <= radius; bz++) {
          if (bx * bx + by * by + bz * bz <= radius * radius) {
            const bp = { x: Math.round(pos.x) + bx, y: Math.round(pos.y) + by, z: Math.round(pos.z) + bz };
            const key = blockKey(bp.x, bp.y, bp.z);
            if (blocks.has(key) && !blocks.get(key)!.permanent) {
              blocks.delete(key);
              deletedBlocks.push(bp);
            }
          }
        }
      }
    }
    if (deletedBlocks.length > 0) {
      broadcast({ type: 'blocks_destroyed', positions: deletedBlocks, ownerId });
    }
  }

  broadcast({ type: 'explosion', pos, radius, ownerId });

  // Damage players
  for (const [, target] of players) {
    if (!target.alive) continue;
    const d = dist3(pos, target.pos);
    if (d < radius + 2) {
      const dmg = Math.max(0, 20 - d * 2);
      applyDamage(target, dmg, ownerId);
    }
  }
}

function checkResourcePickup(p: Player, island: Island) {
  // Generator
  const genDist = dist3(p.pos, island.generatorPos);
  if (genDist < 2.5 && island.generatorTimer <= 0) {
    const rate = GEN_RATES[island.generatorLevel] || 3000;
    const now = Date.now();
    if (now - (island as unknown as Record<string, number>).lastGenTime > rate) {
      (island as unknown as Record<string, number>).lastGenTime = now;
      p.iron = Math.min(p.iron + 2, 99);
      p.gold = Math.min(p.gold + 1, 99);
      send(p.id, { type: 'resources', iron: p.iron, gold: p.gold, diamond: p.diamond, emerald: p.emerald });
    }
  }
}

function checkMidResourcePickup(p: Player) {
  for (const dp of DIAMOND_ISLAND_POSITIONS) {
    if (dist3(p.pos, dp) < 4) {
      const now = Date.now();
      const key = `diamond_${dp.x}_${dp.z}`;
      const lastTime = (globalThis as unknown as Record<string, number>)[key] ?? 0;
      if (now - lastTime > 5000) {
        (globalThis as unknown as Record<string, number>)[key] = now;
        p.diamond = Math.min(p.diamond + 1, 99);
        send(p.id, { type: 'resources', iron: p.iron, gold: p.gold, diamond: p.diamond, emerald: p.emerald });
      }
    }
  }
  for (const ep of EMERALD_ISLAND_POSITIONS) {
    if (dist3(p.pos, ep) < 4) {
      const now = Date.now();
      const key = `emerald_${ep.x}_${ep.z}`;
      const lastTime = (globalThis as unknown as Record<string, number>)[key] ?? 0;
      if (now - lastTime > 8000) {
        (globalThis as unknown as Record<string, number>)[key] = now;
        p.emerald = Math.min(p.emerald + 1, 99);
        send(p.id, { type: 'resources', iron: p.iron, gold: p.gold, diamond: p.diamond, emerald: p.emerald });
      }
    }
  }
}

function checkItemPickup(p: Player) {
  for (const [id, drop] of droppedItems) {
    if (dist3(p.pos, drop.pos) < 1.5) {
      // Check if currency
      if (['iron', 'gold', 'diamond', 'emerald'].includes(drop.item.id)) {
        (p as unknown as Record<string, number>)[drop.item.id] = Math.min(
          ((p as unknown as Record<string, number>)[drop.item.id] as number) + drop.item.count, 99
        );
        send(p.id, { type: 'resources', iron: p.iron, gold: p.gold, diamond: p.diamond, emerald: p.emerald });
      } else {
        giveItem(p, drop.item);
        send(p.id, { type: 'inventory_update', inventory: p.inventory, hotbar: p.hotbar });
      }
      droppedItems.delete(id);
      broadcast({ type: 'item_picked_up', dropId: id, playerId: p.id });
    }
  }
}

function checkAlarmTrigger(p: Player) {
  for (const island of islands) {
    if (!island.playerId || island.playerId === p.id) continue;
    const owner = players.get(island.playerId);
    if (!owner) continue;
    // Check if attacker is near any alarm block on this island
    for (const alarm of island.alarmBlocks) {
      if (dist3(p.pos, alarm) < 8) {
        send(island.playerId, {
          type: 'alarm_triggered',
          attackerName: p.name,
          islandId: island.id
        });
        break;
      }
    }
  }
}

function giveItem(p: Player, item: InventoryItem) {
  // Try to stack in hotbar first
  for (let i = 0; i < p.hotbar.length; i++) {
    const slot = p.hotbar[i];
    if (slot && slot.id === item.id) {
      slot.count += item.count;
      return;
    }
  }
  // Try to stack in inventory
  for (const inv of p.inventory) {
    if (inv.id === item.id) {
      inv.count += item.count;
      return;
    }
  }
  // Find empty hotbar slot
  for (let i = 0; i < p.hotbar.length; i++) {
    if (!p.hotbar[i]) {
      p.hotbar[i] = { ...item };
      return;
    }
  }
  // Add to inventory
  p.inventory.push({ ...item });
}

function removeFromInventory(p: Player, itemId: string, count: number): boolean {
  // Check hotbar
  for (let i = 0; i < p.hotbar.length; i++) {
    const slot = p.hotbar[i];
    if (slot && slot.id === itemId) {
      if (slot.count < count) return false;
      slot.count -= count;
      if (slot.count <= 0) p.hotbar[i] = null;
      return true;
    }
  }
  // Check inventory
  for (let i = 0; i < p.inventory.length; i++) {
    const slot = p.inventory[i];
    if (slot && slot.id === itemId) {
      if (slot.count < count) return false;
      slot.count -= count;
      if (slot.count <= 0) p.inventory.splice(i, 1);
      return true;
    }
  }
  return false;
}

function findAndRemoveItem(p: Player, itemId: string): InventoryItem | null {
  for (let i = 0; i < p.hotbar.length; i++) {
    const slot = p.hotbar[i];
    if (slot && slot.id === itemId) {
      slot.count--;
      const item = { ...slot, count: 1 };
      if (slot.count <= 0) p.hotbar[i] = null;
      return item;
    }
  }
  for (let i = 0; i < p.inventory.length; i++) {
    const slot = p.inventory[i];
    if (slot && slot.id === itemId) {
      slot.count--;
      const item = { ...slot, count: 1 };
      if (slot.count <= 0) p.inventory.splice(i, 1);
      return item;
    }
  }
  return null;
}

function getNearestIsland(pos: Vec3): Island | null {
  let nearest: Island | null = null;
  let nearestDist = Infinity;
  for (const island of islands) {
    const d = dist3(pos, island.center);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = island;
    }
  }
  return nearestDist < 60 ? nearest : null;
}

// Game tick
function gameTick() {
  tickCount++;
  const now = Date.now();

  // Update projectiles
  for (const [id, proj] of projectiles) {
    proj.pos.x += proj.vel.x;
    proj.pos.y += proj.vel.y;
    proj.pos.z += proj.vel.z;
    proj.vel.y -= 0.05; // gravity

    // Check if expired
    if (now - proj.timestamp > 15000) {
      projectiles.delete(id);
      broadcast({ type: 'projectile_removed', id });
      continue;
    }

    // Check block collision
    const key = blockKey(Math.round(proj.pos.x), Math.round(proj.pos.y), Math.round(proj.pos.z));
    const hitBlock = blocks.get(key);

    // TNT fuse
    if ((proj.type === 'tnt' || proj.type === 'world_eater_tnt') && proj.fuse !== undefined) {
      proj.fuse -= TICK_MS;
      if (proj.fuse <= 0 || hitBlock) {
        projectiles.delete(id);
        broadcast({ type: 'projectile_removed', id });
        explodeTNT(proj.pos, 4, proj.ownerId, proj.type === 'world_eater_tnt');
        continue;
      }
    } else if (hitBlock) {
      projectiles.delete(id);
      broadcast({ type: 'projectile_removed', id });
      if (proj.type === 'fireball') {
        explodeTNT(proj.pos, 2, proj.ownerId);
      }
      continue;
    }

    // Check player hit
    for (const [, target] of players) {
      if (target.id === proj.ownerId || !target.alive) continue;
      if (dist3(proj.pos, target.pos) < 1.2) {
        applyDamage(target, proj.damage, proj.ownerId);
        projectiles.delete(id);
        broadcast({ type: 'projectile_removed', id });
        if (proj.type === 'fireball') {
          explodeTNT(proj.pos, 2, proj.ownerId);
        }
        break;
      }
    }
  }

  // Generator ticks (every 20 ticks = 1 second)
  if (tickCount % 20 === 0) {
    for (const island of islands) {
      if (!island.playerId) continue;
      const player = players.get(island.playerId);
      if (!player) continue;
      const rate = GEN_RATES[island.generatorLevel];
      island.generatorTimer -= 1000;
      if (island.generatorTimer <= 0) {
        island.generatorTimer = rate;
        player.iron = Math.min(player.iron + 2, 99);
        player.gold = Math.min(player.gold + 1, 99);
        if (island.generatorLevel >= 3) {
          player.diamond = Math.min(player.diamond + 1, 64);
        }
        send(player.id, { type: 'resources', iron: player.iron, gold: player.gold, diamond: player.diamond, emerald: player.emerald });
      }
    }
  }

  // Essence ticks (every 60 seconds)
  if (tickCount % 1200 === 0) {
    for (const [, p] of players) {
      if (p.bedAlive && p.alive) {
        p.essence += 5;
        send(p.id, { type: 'essence_update', essence: p.essence });
      }
    }
  }

  // Auto-turret ticks
  if (tickCount % 20 === 0) {
    for (const island of islands) {
      for (const turret of island.autoTurrets) {
        if (turret.ammo <= 0) continue;
        if (now - turret.lastFired < 2000) continue;
        // Find nearest enemy
        let nearest: Player | null = null;
        let nearestDist = 20;
        for (const [, p] of players) {
          if (!p.alive || p.islandId === island.id) continue;
          const d = dist3(p.pos, turret.pos);
          if (d < nearestDist) { nearestDist = d; nearest = p; }
        }
        if (nearest) {
          turret.lastFired = now;
          turret.ammo--;
          applyDamage(nearest, 4, island.playerId ?? 'turret');
          broadcast({ type: 'turret_fired', turretPos: turret.pos, targetId: nearest.id });
        }
      }
    }
  }

  // Broadcast projectile positions every 2 ticks
  if (tickCount % 2 === 0 && projectiles.size > 0) {
    const projList = [...projectiles.values()].map(pr => ({ id: pr.id, pos: pr.pos }));
    broadcast({ type: 'projectile_positions', projectiles: projList });
  }

  // Broadcast player states every 3 ticks  
  if (tickCount % 3 === 0) {
    const playerList = [...players.values()].filter(p => p.alive && p.loggedIn).map(getPublicPlayerData);
    if (playerList.length > 0) {
      broadcast({ type: 'state_update', players: playerList });
    }
  }
}

// HTTP + WebSocket handler
Deno.serve((req: Request) => {
  const url = new URL(req.url);

  // CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // REST: server info
  if (url.pathname === '/info') {
    return new Response(JSON.stringify({
      players: players.size,
      maxPlayers: ISLAND_COUNT,
      islandsFree: islands.filter(i => !i.playerId).length,
      clans: clans.size,
      uptime: tickCount * TICK_MS,
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }

  // WebSocket upgrade
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Bedwars Ultimate Server', { headers: corsHeaders });
  }

  const { socket: ws, response } = Deno.upgradeWebSocket(req);
  const playerId = uid();

  ws.onopen = () => {
    const islandId = findFreeIsland();
    if (islandId === -1) {
      ws.send(JSON.stringify({ type: 'error', message: 'Server full (80 players max)' }));
      ws.close();
      return;
    }

    const playerName = url.searchParams.get('name')?.slice(0, 16).replace(/[^a-zA-Z0-9_]/g, '') || `Player${islandId + 1}`;

    const player: Player = {
      id: playerId,
      name: playerName,
      ws,
      pos: { x: 0, y: BASE_Y + 2, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      health: 20,
      maxHealth: 20,
      armor: 0,
      inventory: [],
      hotbar: [null, null, null, null, null, null, null, null, null],
      selectedSlot: 0,
      islandId,
      bedAlive: true,
      alive: true,
      clanId: null,
      essence: 0,
      kills: 0,
      bounty: 0,
      combatTag: 0,
      lastHit: 0,
      loggedIn: true,
      savedState: null,
      yaw: 0,
      pitch: 0,
      iron: 0,
      gold: 0,
      diamond: 0,
      emerald: 0,
    };

    islands[islandId].playerId = playerId;
    islands[islandId].bedAlive = true;
    players.set(playerId, player);

    // Give starting wooden sword
    giveItem(player, { id: 'wooden_sword', name: 'Wooden Sword', count: 1, type: 'weapon', damage: 4, texture: 'wooden_sword' });
    giveItem(player, { id: 'wooden_pickaxe', name: 'Wooden Pickaxe', count: 1, type: 'tool', damage: 2, texture: 'wooden_pickaxe' });

    // Send initial world state
    const worldBlocks = [...blocks.values()];
    ws.send(JSON.stringify({
      type: 'init',
      playerId,
      playerName,
      islandId,
      island: serializeIsland(islands[islandId]),
      pos: { x: islands[islandId].center.x, y: islands[islandId].center.y + 2, z: islands[islandId].center.z },
      players: [...players.values()].filter(p => p.id !== playerId).map(getPublicPlayerData),
      blocks: worldBlocks,
      islands: islands.map(serializeIsland),
      diamondIslands: DIAMOND_ISLAND_POSITIONS,
      emeraldIslands: EMERALD_ISLAND_POSITIONS,
      hotbar: player.hotbar,
      inventory: player.inventory,
      shopItems: SHOP_ITEMS,
      bountyBoard: [...bountyBoard.values()],
    }));

    // Tell others about new player
    broadcast({
      type: 'player_joined',
      player: getPublicPlayerData(player),
      island: serializeIsland(islands[islandId])
    }, playerId);

    spawnPlayer(player);
  };

  ws.onmessage = (e: MessageEvent) => {
    handleMessage(playerId, e.data);
  };

  ws.onclose = () => {
    const p = players.get(playerId);
    if (p) {
      handlePlayerLogout(p);
      if (!p.bedAlive) {
        players.delete(playerId);
        islands[p.islandId].playerId = null;
      }
    }
    broadcast({ type: 'player_left', playerId });
  };

  ws.onerror = () => {
    ws.close();
  };

  return response;
});

// Initialize world
initIslands();

// Start game loop
setInterval(gameTick, TICK_MS);

console.log('Bedwars Ultimate server running!');
