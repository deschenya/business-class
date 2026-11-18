// Типы игрового ядра. Ядро не зависит от UI/3D: состояние — чистый JSON,
// изменения — только через applyAction(state, action).

export type Color = 'red' | 'yellow' | 'green' | 'blue';
export const COLORS: Color[] = ['red', 'yellow', 'green', 'blue'];
export const COLOR_RU: Record<Color, string> = { red: 'красная', yellow: 'жёлтая', green: 'зелёная', blue: 'синяя' };
export const COLOR_RU_PL: Record<Color, string> = { red: 'красные', yellow: 'жёлтые', green: 'зелёные', blue: 'синие' };

export type PlayerId = string;
export type Party = PlayerId | 'bank';
export type RoleId = 'banker' | 'broker' | 'chairman' | 'inspector';
export const ROLE_RU: Record<RoleId, string> = {
  banker: 'Банкир',
  broker: 'Старший брокер биржи',
  chairman: 'Председатель комитета по имуществу',
  inspector: 'Муниципальный инспектор',
};

export type Pos =
  | { z: 'c'; id: number } // клетка периметра (0..55)
  | { z: 'h'; n: number } // автострада 1..10
  | { z: 'x'; lane: Color | null; n: number } // биржа: дорожка и клетка (0 — вход)
  | { z: 'r'; slot: number }; // рулетка: сектор

// ---------------------------------------------------------------- данные поля
export interface CompanyCell {
  id: number; zone: 'outer' | 'inner'; type: string; name: string; xy: [number, number];
  color?: Color; quote?: number; price?: number | null; rent?: { plot: number; branch: number; enterprise: number };
  rentSingle?: number; kind?: string; deck?: string; amount?: number; stocks?: number; fee?: number;
  premium?: number; transferFee?: number; twin?: number; entryFee?: number; exitDuty?: number; exitPerRuProperty?: number;
  ownerTax?: number; exchangeFee?: number; bonusPass?: number; ownable?: boolean;
  проверить?: string; требует_оцифровки?: string;
}
export interface HighwayCell { id: string; n: number; name: string; xy: [number, number]; effect: HighwayEffect }
export type HighwayEffect =
  | { kind: 'money'; amount: number }
  | { kind: 'draw'; deck: DeckId }
  | { kind: 'stocks'; count: number }
  | { kind: 'skip' }
  | { kind: 'chooseCard'; deck: DeckId };
export interface RouletteSector { slot: number; label: string; value: number | null; type?: string; start?: boolean; exit?: boolean; xy: [number, number]; требует_оцифровки?: string }
export interface BoardData {
  image: string; size: number;
  cells: CompanyCell[];
  groups: { color: Color; cells: number[]; примечание?: string }[];
  edges: {
    innerLoop: number[];
    branches: { from: number; to: number; label: string; fee?: number; feeKey?: string }[];
    bankTransfer: { a: number; b: number; fee: number };
    highway: { from: number; exits: number[] };
  };
  highway: HighwayCell[];
  exchange: { lanes: { color: Color; cells: [number, number][] }[]; start: [number, number]; specialCells: number[]; length: number; exits: number[] };
  roulette: { center: [number, number]; startSlot: number; order: number[]; lapsToLeave: number; exitTo: number[]; sectors: RouletteSector[] };
}

export type DeckId = 'notice' | 'gift' | 'surprise' | 'fine';
export type CardEffect =
  | { kind: 'none' }
  | { kind: 'manual'; требует_оцифровки?: string }
  | { kind: 'choice'; options: { label: string; effect: CardEffect }[] }
  | { kind: 'extraTurn'; oneDie?: boolean }
  | { kind: 'oneDieNext'; target: 'opposite' }
  | { kind: 'distribute'; amount: number }
  | { kind: 'collectFromEach'; amount: number }
  | { kind: 'rentWaiver'; target: 'opposite' }
  | { kind: 'takeStock'; target: 'chosen'; color: Color; count: number }
  | { kind: 'money'; amount: number }
  | { kind: 'skipTurn'; target: 'next' | 'self' }
  | { kind: 'sellBranchToLady' }
  | { kind: 'giveStock'; target: 'right'; count: number }
  | { kind: 'swapStock' }
  | { kind: 'payTo'; target: 'right'; amount: number };
export interface Card { id: string; image: string; text: string; effect: CardEffect }
export type ExEffect =
  | { op: 'div'; value: number; color?: Color; choose?: boolean }
  | { op: 'mul'; value: number; color?: Color; choose?: boolean }
  | { op: 'add'; value: number; color: Color }
  | { op: 'addOthers'; value: number; others: number; color: Color }
  | { op: 'assign'; values: number[] };
export interface ExCard { id: string; image: string; color: Color | 'white'; text: string; effect: ExEffect }
export interface CardsData {
  decks: Record<DeckId, { name: string; back: string; cards: Card[] }> & { exchange: { name: string; back: string; cards: ExCard[] } };
}
export interface GameData { board: BoardData; cards: CardsData }

// ---------------------------------------------------------------- состояние
export interface Player {
  id: PlayerId; name: string; color: string; avatar: string; lady: boolean;
  money: number;
  stocks: Record<Color, number>;
  quotes: Record<Color, number>;
  pos: Pos;
  skip: number;
  oneDieNext: boolean;
  bankrupt: boolean;
  rentWaivers: PlayerId[]; // «игрок не берёт с Вас аренду» (по одному разу)
}

export type Level = 'plot' | 'branch' | 'enterprise' | 'firm';
export const LEVEL_RU: Record<Level, string> = { plot: 'участок', branch: 'филиал', enterprise: 'предприятие', firm: 'фирма' };
export interface Property { cell: number; owner: Party; level: Level; pledged: string | null; paid: number }

export interface Loan {
  id: string; player: PlayerId; cell: number; kind: 'money' | 'stocks';
  amount: number; // $ на момент выдачи
  stocks?: { color: Color; count: number; quote: number };
  remaining: number; // шагов по периметру до срока
  perimeter: 'outer' | 'inner';
  status: 'active' | 'repaid' | 'defaulted';
  issuedTurn: number;
}

export interface RentClaim { id: string; payer: PlayerId; owner: PlayerId; cell: number; amount: number; level: Level; rollIndex: number; status: 'open' | 'paid' | 'expired' | 'waived' }
export interface Debt { id: string; debtor: PlayerId; creditor: Party; amount: number; reason: string }

export type Lot = { type: 'prop'; cell: number } | { type: 'stock'; color: Color; count: number };
export interface Auction { id: string; lot: Lot; seller: Party; initiator: PlayerId; bids: Record<PlayerId, number>; conductor: RoleId; bankCollateral: boolean }
export interface Bundle { money: number; stocks: Partial<Record<Color, number>>; cells: number[] }
export interface Trade { id: string; from: PlayerId; to: PlayerId; give: Bundle; take: Bundle; status: 'proposed' | 'accepted' | 'done' | 'declined' | 'cancelled' }

export interface PromptOption { id: string; label: string; hint?: string; disabled?: boolean; tone?: 'primary' | 'danger' | 'muted' }
export interface PromptForm {
  kind: 'stockCounts' | 'distribute' | 'assignColors' | 'amount' | 'pickPlayer' | 'pickCell' | 'pickColor' | 'pickCard';
  total?: number; step?: number; min?: number; max?: number; values?: number[];
  players?: PlayerId[]; cells?: number[]; colors?: Color[]; cards?: number; deck?: DeckId | 'exchange'; faceUp?: string[];
}
export interface Prompt {
  id: string;
  to: PlayerId | 'host' | RoleId;
  title: string;
  text?: string;
  options: PromptOption[];
  form?: PromptForm;
  ctx: { type: string; [k: string]: any };
  card?: { deck: DeckId | 'exchange'; id: string };
}

export type Ruling = { key: string; title: string; options: { id: string; label: string }[]; note?: string };

export interface LogEntry { i: number; turn: number; kind: 'info' | 'money' | 'market' | 'ruling' | 'card' | 'warn' | 'turn' | 'prop'; text: string; player?: PlayerId }
export interface Transfer { i: number; turn: number; from: Party; to: Party; amount: number; reason: string }
export interface MarketEntry { i: number; turn: number; player: PlayerId; color: Color; from: number; to: number; reason: string }

export interface Settings {
  startMoney: number;
  startQuote: number;
  startStocks: number;
  rentNeedsClaim: boolean;
  allowForcedDice: boolean;
}

export interface ExchangeCtx { player: PlayerId; lane: Color | null; n: number; mode: 'simple' | 'risk' | null; origin: Pos; from66: boolean; done: boolean; stops: number[] }
export interface RouletteCtx { player: PlayerId; slot: number; traveled: number; rolls: number; maxRolls: number | null; returnTo: number | null }

export interface GameState {
  v: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  data: GameData;
  settings: Settings;
  rulings: Record<string, string>;
  roles: Record<RoleId, PlayerId | 'host'>;
  players: Player[];
  order: PlayerId[];
  turn: { n: number; player: PlayerId; stage: 'pre' | 'post' | 'over'; dice: number[] | null; extra: boolean; extraOneDie: boolean; oneDie: boolean; rolled: boolean };
  rollIndex: number;
  props: Record<number, Property>;
  loans: Loan[];
  claims: RentClaim[];
  debts: Debt[];
  auction: Auction | null;
  trades: Trade[];
  prompts: Prompt[];
  exchange: ExchangeCtx | null;
  roulette: RouletteCtx | null;
  log: LogEntry[];
  ledger: Transfer[];
  market: MarketEntry[];
  bankStats: { paidOut: number; received: number };
  rng: number;
  seq: number;
  winner: PlayerId | null;
  /** результаты розыгрыша очерёдности: броски каждого игрока (с перебросами при равенстве) */
  orderRoll?: { player: PlayerId; rolls: number[][] }[];
}

// ---------------------------------------------------------------- события для анимации
export type GameEvent =
  | { t: 'dice'; player: PlayerId; values: number[] }
  | { t: 'move'; player: PlayerId; path: Pos[] }
  | { t: 'teleport'; player: PlayerId; to: Pos }
  | { t: 'money'; from: Party; to: Party; amount: number; reason: string }
  | { t: 'card'; deck: DeckId | 'exchange'; card: string; player: PlayerId }
  | { t: 'quotes'; changes: { player: PlayerId; color: Color; from: number; to: number }[] }
  | { t: 'prop'; cell: number; owner: Party | null; level: Level | null }
  | { t: 'toast'; text: string; tone?: 'good' | 'bad' | 'info' }
  | { t: 'bankrupt'; player: PlayerId };

// ---------------------------------------------------------------- действия
export type Action =
  | { type: 'roll'; by: PlayerId; force?: number[] }
  | { type: 'answer'; by: PlayerId | 'host'; prompt: string; option: string; payload?: any }
  | { type: 'endTurn'; by: PlayerId }
  | { type: 'claimRent'; by: PlayerId | 'host'; claim: string }
  | { type: 'buyStock'; by: PlayerId; color: Color; count: number }
  | { type: 'sellStock'; by: PlayerId; color: Color; count: number }
  | { type: 'payDebt'; by: PlayerId; debt: string }
  | { type: 'requestLoan'; by: PlayerId; cell: number; kind: 'money' | 'stocks'; amount?: number; color?: Color; count?: number }
  | { type: 'repayLoan'; by: PlayerId; loan: string }
  | { type: 'auctionStart'; by: PlayerId; lot: Lot }
  | { type: 'auctionBid'; by: PlayerId; amount: number }
  | { type: 'auctionClose'; by: PlayerId | 'host' }
  | { type: 'auctionCancel'; by: PlayerId | 'host' }
  | { type: 'tradePropose'; by: PlayerId; to: PlayerId; give: Bundle; take: Bundle }
  | { type: 'tradeRespond'; by: PlayerId; trade: string; accept: boolean }
  | { type: 'tradeConfirm'; by: PlayerId | 'host'; trade: string; ok: boolean }
  | { type: 'hostAdjust'; by: 'host'; player: PlayerId; money?: number; color?: Color; stocks?: number; quote?: number; reason: string }
  | { type: 'hostSetOwner'; by: 'host'; cell: number; owner: Party | null; level?: Level; reason: string }
  | { type: 'roleFine'; by: 'host'; role: RoleId; reason: string }
  | { type: 'setRuling'; by: 'host'; key: string; value: string }
  | { type: 'editData'; by: 'host'; path: (string | number)[]; value: any }
  | { type: 'declareBankrupt'; by: PlayerId | 'host'; player: PlayerId }
  | { type: 'hostNote'; by: 'host'; text: string }
  | { type: 'hostMove'; by: 'host'; player: PlayerId; to: Pos; reason: string }
  | { type: 'endGame'; by: 'host' };

export interface ApplyResult { state: GameState; events: GameEvent[]; error?: string }
