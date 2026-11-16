// The Pipeline Studio's one source of truth: every node on the canvas, what it does, what it takes in and passes on, and which settings are bound to it.
// Descriptions are written from the code named in each node's `source` (a test checks those files exist) and from shared/pipeline-config.ts and shared/chat-why.ts.
// Ids match the pipeline config's locked-rule ids (permission_gate, fence_flags, exclusion_lists, hard_prompt_rules, redaction, protocol_limits, provider_contracts) and the failure
// explainer's node ids (reply-integrity, token-budget, run-control, provider-run, request-intake, request-queue, chat-store, session-intake) wherever those exist.
// Data only. Nothing here enforces anything or reads a file: the server stays the authority on what is accepted.
import {DEFAULT_PIPELINE_CONFIG,locked,type PipelineConfig,type PipelineSafetyLabel} from './pipeline-config.ts';

export type NodeKind='editable'|'locked';
export type NodeGroup='request'|'guard'|'answer'|'checks'|'investigate'|'council'|'records';
export const GROUP_LABEL:Readonly<Record<NodeGroup,string>>=Object.freeze({request:'Your request',guard:'Guards',answer:'Answer',checks:'Checks on the reply',investigate:'Investigate',council:'Council',records:'Records'});
export const GROUP_ORDER:readonly NodeGroup[]=['request','guard','answer','checks','investigate','council','records'];

/** A numeric setting a node exposes. `key` is a path in the pipeline config; the range is the server's own (a test holds this table to the real validator). */
export interface FieldSpec {key:string;label:string;unit:string;min:number;max:number;/** Decimals allowed (the validator accepts non-integers for these). */fractional?:boolean;help?:string}
export const FIELDS:Readonly<Record<string,FieldSpec>>=Object.freeze(Object.fromEntries(([
 {key:'chat.noteCharacters',label:'Largest note it will take',unit:'characters',min:1,max:40000,help:'A note longer than this is refused with a context-limit error.'},
 {key:'chat.questionCharacters',label:'Longest question',unit:'characters',min:1,max:2000},
 {key:'chat.sources',label:'Most sources per message',unit:'sources',min:1,max:8,help:'The note, its threads and every attached note or session count.'},
 {key:'chat.otherCharacters',label:'Size limit for other notes',unit:'characters',min:1,max:20000},
 {key:'chat.historyPairs',label:'Earlier exchanges kept',unit:'pairs',min:0,max:4},
 {key:'chat.historyCharacters',label:'Earlier exchanges, size limit',unit:'characters',min:0,max:4000},
 {key:'conversation.carryTokenCap',label:'Carried conversation, token cap',unit:'tokens',min:1,max:6000},
 {key:'chat.tokenBudget',label:'Token budget per chat',unit:'tokens',min:1000,max:1000000},
 {key:'chat.rollingRequestCap',label:'Requests per hour, per chat',unit:'requests',min:1,max:60},
 {key:'estimates.replyAllowance',label:'Room kept for the reply',unit:'tokens',min:1,max:100000},
 {key:'estimates.cacheReadWeight',label:'Cached tokens count as',unit:'of a token',min:0,max:1,fractional:true},
 {key:'estimates.bytesPerToken',label:'Bytes per token (estimate)',unit:'bytes',min:1,max:8,fractional:true},
 {key:'transport.cliTimeoutMs',label:'One CLI call may take',unit:'ms',min:1,max:180000},
 {key:'transport.sessionTimeoutMs',label:'A conversation turn may take',unit:'ms',min:1,max:180000},
 {key:'investigate.budgetUsd',label:'Investigate, cost cap per message',unit:'USD',min:0.05,max:5,fractional:true},
 {key:'investigate.timeoutMs',label:'Investigate, time limit',unit:'ms',min:1,max:300000},
 {key:'conversation.budgetUsd',label:'Conversation plan, default cost cap',unit:'USD',min:0.05,max:5,fractional:true},
 {key:'diagram.turnCapUsd',label:'Cost cap for a turn that opens diagrams',unit:'USD',min:0.05,max:5,fractional:true},
 {key:'council.outputBytes',label:'Longest Council answer',unit:'bytes',min:1,max:262144},
 {key:'council.caps.claude.amount',label:'Claude cap per question',unit:'USD',min:0.01,max:5,fractional:true},
 {key:'council.caps.claude.deadlineMs',label:'Claude deadline',unit:'ms',min:100,max:180000},
 {key:'council.caps.codex.amount',label:'Codex cap per question',unit:'tokens',min:1,max:100000},
 {key:'council.caps.codex.deadlineMs',label:'Codex deadline',unit:'ms',min:100,max:180000},
 {key:'council.caps.kiro.amount',label:'Kiro cap per question',unit:'credits',min:0.001,max:2,fractional:true},
 {key:'council.caps.kiro.deadlineMs',label:'Kiro deadline',unit:'ms',min:100,max:180000},
] as FieldSpec[]).map(f=>[f.key,Object.freeze(f)])));

export interface PipelineNode {
 id:string;label:string;kind:NodeKind;group:NodeGroup;
 /** What it does, what it receives, what it sends on: plain language, top to bottom on the card. */
 does:string;receives:string;sendsOn:string;
 /** Config keys of the numeric settings this node exposes (each is a key of FIELDS). Empty for a locked node. */
 fields:readonly string[];
 /** The node that chooses who answers Normal chat: it edits `normalAnswerer` rather than a number. */
 answerer?:true;
 /** The provider whose safety label (from the config) this node carries. */
 provider?:'claude'|'codex'|'kiro';
 /** A locked node says why: either the id of a locked rule in the pipeline config (its own sentence is used), or its own reason. */
 lockedBy?:string;lockedReason?:string;
 /** Where the flow goes next (ids). */
 edges:readonly string[];
 /** The files the description was written from. */
 source:readonly string[];
 /** Default place on the canvas (world units). */
 x:number;y:number;
}
const n=(node:PipelineNode):PipelineNode=>Object.freeze({...node,fields:Object.freeze([...node.fields]),edges:Object.freeze([...node.edges]),source:Object.freeze([...node.source])});

export const PIPELINE_NODES:readonly PipelineNode[]=Object.freeze([
 n({id:'request-intake',label:'Your note and mode',kind:'editable',group:'request',x:32,y:200,
  does:'Gathers the open note, your selection, your question and anything you attach into one request. A note over its size limit, or a question that is too long, is refused before anything is sent. You also choose the thinking-partner mode here (Plan, Grill or Explain).',
  receives:'Your question, the open note, the selection, notes you attach with @, and the mode you picked.',sendsOn:'One request to the redaction pass.',
  fields:['chat.noteCharacters','chat.questionCharacters','chat.sources','chat.otherCharacters'],edges:['redaction'],source:['server/chat/context.ts','server/chat/runtime.ts','server/providers/index.ts','shared/chat.ts','shared/persona.ts']}),
 n({id:'chat-history',label:'Earlier exchanges',kind:'editable',group:'request',x:32,y:328,
  does:'Adds the recent question-and-answer pairs Aitiarch itself kept, cleaned of secrets again, up to a count and a size limit. Claude keeps its own session, so nothing is pasted for it. A fresh session, or a changed answerer, is given your earlier questions and answers, up to a carried-conversation token cap.',
  receives:'The pairs saved for this conversation.',sendsOn:'The pairs that fit, to the redaction pass.',
  fields:['chat.historyPairs','chat.historyCharacters','conversation.carryTokenCap'],edges:['redaction'],source:['server/chat/normal-answerer.ts','server/providers/index.ts','shared/chat.ts']}),
 n({id:'session-intake',label:'IDE sessions you pick',kind:'locked',group:'request',x:32,y:72,lockedBy:'protocol_limits',
  does:'Lets you pick Claude or Codex sessions as extra context. Sessions from this project are offered; you can tick "other projects" to see the rest. A session whose format changed or cannot be verified, or one over the safe size, is refused. Only Claude can answer with sessions attached, and replies are then kept in memory only.',
  receives:'The sessions you tick under Context.',sendsOn:'Their text, as extra sources, to your request.',
  fields:[],edges:['request-intake'],source:['shared/chat.ts','shared/ide-sessions.ts','server/chat/ide-sessions.ts','shared/chat-why.ts']}),
 n({id:'repo-attach',label:'Repo and files you attach',kind:'locked',group:'request',x:32,y:456,lockedBy:'permission_gate',
  does:'Attaching the repo or files with @ turns the message into an Investigate turn. Each file is checked; one that is refused blocks the whole message until you remove it.',
  receives:'The repo folder you chose and the files you picked.',sendsOn:'A plan card to the permission gate.',
  fields:[],edges:['permission_gate'],source:['shared/profile.ts','src/chat/PlanCard.tsx','src/chat/conversation-model.ts']}),
 n({id:'redaction',label:'Redaction',kind:'locked',group:'guard',x:304,y:200,lockedBy:'redaction',
  does:'Masks key-like text in what you write and attach: your question, selection, notes and earlier exchanges. It matches patterns, so it is best effort. It runs as the request is built and again just before it leaves; the approval check happens later, at send. Repo files are covered by exclusion lists, not masking. It also blocks adding a reply to your note when the reply may contain a secret.',
  receives:'The request and the earlier exchanges.',sendsOn:'The cleaned request, which the permission gate checks at send.',
  fields:[],edges:['permission_gate'],source:['server/providers/index.ts','server/chat/secrets.ts','shared/chat.ts']}),
 n({id:'hard_prompt_rules',label:'Fixed prompt rules',kind:'locked',group:'guard',x:304,y:712,lockedBy:'hard_prompt_rules',
  does:'The rules that go with every message. They are asked of the model, not enforced here: fields that belong to you stay yours, notes are untrusted data, answers are grounded in what was sent, and the output has a fixed shape. Afterwards only the reply check’s list of allowed fields and the claim marks check anything.',
  receives:'Nothing from you.',sendsOn:'The fixed instruction, last in every message, to the answerer.',
  fields:[],edges:['normal-answerer'],source:['server/chat/request.ts','shared/instruction.ts']}),
 n({id:'permission_gate',label:'Permission gate',kind:'locked',group:'guard',x:304,y:328,lockedBy:'permission_gate',
  does:'Checks, when you send, that the message was reviewed, that the approved plan covers it (for a conversation), and that the approval belongs to this conversation. If not, nothing is sent. It runs after the busy check and before the hourly cap and budget.',
  receives:'The reviewed request and any plan you approved.',sendsOn:'An approved request on to the hourly cap and budget checks; an approved plan to Investigate, diagrams or Council.',
  fields:[],edges:['request-queue','investigate','diagram-route','council'],source:['server/chat/runtime.ts','shared/chat.ts','server/harness/conversation.ts']}),
 n({id:'request-queue',label:'Request queue',kind:'locked',group:'guard',x:304,y:456,lockedReason:'It runs one request per chat at a time and at most two chats at once. This is a fixed rule in code; no setting exists for it.',
  does:'The first limit check when you send: one request per chat at a time, and at most two chats at once. A request that does not fit is refused as busy; nothing waits in line. Starting a review is also refused as busy when 20 reviews are pending, or when 50 one-off chats or 50 conversations are already kept. At send the order is: busy check, approval check, then the hourly cap and the token budget. The arrows show a message’s path, not that order.',
  receives:'A reviewed request, at send.',sendsOn:'The request on to the approval check, then the token budget check.',
  fields:[],edges:['token-budget'],source:['server/chat/runtime.ts']}),
 n({id:'token-budget',label:'Token budget',kind:'editable',group:'guard',x:304,y:584,
  does:'Keeps each chat inside its token budget and its hourly request cap. Before a send it refuses when this message would pass either. While a reply streams it ends the run when the reply no longer fits.',
  receives:'The approved request and what this chat has used so far.',sendsOn:'The request to the answerer.',
  fields:['chat.tokenBudget','chat.rollingRequestCap','estimates.replyAllowance','estimates.cacheReadWeight','estimates.bytesPerToken'],edges:['normal-answerer'],source:['server/chat/runtime.ts','shared/chat.ts']}),
 n({id:'normal-answerer',label:'Normal chat answerer',kind:'editable',group:'answer',x:576,y:584,answerer:true,
  does:'Chooses who writes the reply to a Normal chat message: Claude, Codex or Kiro. Codex and Kiro get your notes, the selection and earlier exchanges, but no repo, files or sessions, under a cap you approve per conversation. If the chosen provider fails, no other provider is tried.',
  receives:'The checked request and the fixed prompt rules.',sendsOn:'The request to the chosen provider: Claude’s run, or Codex or Kiro through their provider contracts.',
  fields:[],edges:['provider-run','provider_contracts'],source:['server/chat/normal-answerer.ts','server/chat/runtime.ts','shared/pipeline-config.ts']}),
 n({id:'diagram-route',label:'Diagrams in a turn',kind:'editable',group:'answer',x:576,y:200,
  does:'A conversation turn may open the pictures of the note’s diagrams, one at a time with Read. Diagrams that are withheld are listed with the reason. A turn may open 12 files and is stopped on anything else: a path outside the folder, any other tool, hooks or denials, a changed folder, or a repeated read of a withheld diagram. The cost cap is passed to Claude.',
  receives:'The approved plan and the diagrams of the open note.',sendsOn:'A turn inside the fence.',
  fields:['diagram.turnCapUsd'],edges:['fence_flags'],source:['shared/diagram-fence.ts','server/harness/diagram-watch.ts','server/chat/runtime.ts']}),
 n({id:'fence_flags',label:'Fence and pinned flags',kind:'locked',group:'answer',x:576,y:328,lockedBy:'fence_flags',
  does:'The pinned way Claude is started: its flags, its tool set and its isolation. A CLI version the diagram fence was not verified on is flagged in Settings.',
  receives:'A turn to run.',sendsOn:'The run, inside the fence.',
  fields:[],edges:['provider-run','investigate'],source:['server/providers/claude-arguments.ts','server/providers/launcher.ts','shared/diagram-fence.ts']}),
 n({id:'provider-run',label:'Claude run',kind:'locked',group:'answer',x:848,y:456,provider:'claude',lockedBy:'fence_flags',
  does:'Claude answers through the no-tools fence. A run that does not finish is reported with its reason: not set up, flag rejected, timeout, login, exited, unreadable reply, output or context limit, cost cap or the fence.',
  receives:'The request, from the answerer or the fence.',sendsOn:'Claude’s reply to the reply integrity check.',
  fields:[],edges:['reply-integrity'],source:['server/providers/claude-turn.ts','server/providers/tool-less.ts','shared/chat-why.ts','src/chat/council-view.ts']}),
 n({id:'provider_contracts',label:'Provider contracts',kind:'locked',group:'answer',x:848,y:712,lockedBy:'provider_contracts',
  does:'What Codex and Kiro are allowed to do: they get your notes, the selection, the editor line and earlier exchanges, with no repo, files, diagrams or sessions. Their safety label describes how they are contained; it does not confine them. A provider that is unavailable, refuses or fails is reported with no fallback.',
  receives:'The request, when Codex or Kiro answers.',sendsOn:'The provider’s reply to the reply integrity check.',
  fields:[],edges:['reply-integrity'],source:['server/chat/normal-answerer.ts','shared/chat-why.ts','server/providers/turn.ts']}),
 n({id:'run-control',label:'Stop and deadlines',kind:'editable',group:'answer',x:576,y:456,
  does:'Lets you stop a request. The time limit for one CLI call and the limit for a conversation turn both start after the Claude process starts, and end it with a provider failure. Codex, Kiro and Council use per-provider deadlines (on their Council nodes), and Investigate uses its own timer.',
  receives:'A running request and your Stop.',sendsOn:'The end of the run, with the reason.',
  fields:['transport.cliTimeoutMs','transport.sessionTimeoutMs'],edges:['provider-run'],source:['server/providers/index.ts','server/harness/claude-session.ts','shared/chat-why.ts']}),
 n({id:'protocol_limits',label:'Protocol limits',kind:'locked',group:'checks',x:1120,y:528,lockedBy:'protocol_limits',
  does:'Ceilings kept in code: how long an answer may be, how many claims it may carry and how long a quote may be.',
  receives:'Nothing from you.',sendsOn:'The ceilings to the reply integrity check.',
  fields:[],edges:['reply-integrity'],source:['shared/chat-why.ts','server/product-validation.ts']}),
 n({id:'reply-integrity',label:'Reply integrity check',kind:'locked',group:'checks',x:1120,y:656,lockedBy:'hard_prompt_rules',
  does:'Checks the reply is for this request and from the expected provider, that the answer is non-empty text, and that its claims, usage and cost have the right shape. A reply that fails is not kept.',
  receives:'The provider’s reply.',sendsOn:'An accepted reply to the claim check.',
  fields:[],edges:['claim-check'],source:['server/product-validation.ts','server/chat/runtime.ts','shared/chat-why.ts']}),
 n({id:'claim-check',label:'Claim check',kind:'locked',group:'checks',x:1120,y:784,lockedBy:'hard_prompt_rules',
  does:'Looks for each claim’s quote in the source it names. The reply is shown with each claim marked found or not found.',
  receives:'The accepted reply and the sources that were sent.',sendsOn:'The reply, with its claim marks, to be saved.',
  fields:[],edges:['chat-store'],source:['server/chat/reply.ts','shared/chat.ts','shared/chat-why.ts']}),
 n({id:'chat-store',label:'Saving the reply',kind:'locked',group:'checks',x:1120,y:912,lockedReason:'Saving is not a pipeline setting. Replies are kept privately beside the note, or in memory only until you choose Keep on disk privately in the chat, which adds /chat/ to the notebook’s .gitignore.',
  does:'Saves the reply privately beside the note, or keeps it in memory only until you choose Keep on disk privately, which adds /chat/ to the notebook’s .gitignore. A reply from a chat with sessions attached is never saved to disk.',
  receives:'The checked reply.',sendsOn:'What happened, to the ledger.',
  fields:[],edges:['ledger'],source:['server/chat/runtime.ts','src/chat/ChatPanel.tsx']}),
 n({id:'exclusion_lists',label:'Snapshot and secret exclusion',kind:'locked',group:'investigate',x:1392,y:528,lockedBy:'exclusion_lists',
  does:'Investigate reads a copy of your repo made by Aitiarch: only files git knows about, never files named like secrets or keys, tooling folders or state, never links, never very large files. Only names are checked: the contents of copied files are not scanned.',
  receives:'Your repo.',sendsOn:'A read-only copy to Investigate.',
  fields:[],edges:['investigate'],source:['server/harness/snapshot.ts']}),
 n({id:'investigate',label:'Investigate',kind:'editable',group:'investigate',x:1392,y:656,
  does:'Claude reads the read-only copy of your repo with Read, Grep and Glob and explains the code. Each message has a cost cap and a time limit. Its answerer is Claude; choosing another provider for it is not available yet.',
  receives:'An approved plan, the repo copy and your question.',sendsOn:'An answer with its trail of tool calls, then to the tripwire and the ledger.',
  fields:['investigate.budgetUsd','investigate.timeoutMs','conversation.budgetUsd'],edges:['tripwire','ledger'],source:['server/harness/investigate.ts','server/harness/conversation.ts','server/pipeline-config-store.ts']}),
 n({id:'tripwire',label:'Watcher and tripwire',kind:'locked',group:'investigate',x:1392,y:784,lockedReason:'It compares the notebook folder before and after every investigation run. No setting exists for it, and restoring is always an action you take.',
  does:'Before an investigation it hashes the notebook folder and keeps a copy of each file up to 8 MB; after, it lists in the chat what changed, was added or was removed. The app’s own state and .git are not compared. Restoring is your action: it puts changed and removed files back and deletes added ones, and a file over 8 MB cannot be put back.',
  receives:'The notebook folder before and after a run.',sendsOn:'The list of changes, to the chat.',
  fields:[],edges:[],source:['server/harness/tripwire.ts','server/harness/investigate.ts']}),
 n({id:'council',label:'Council',kind:'editable',group:'council',x:1120,y:200,
  does:'Asks the providers you choose (one to three of Claude, Codex and Kiro) the same question about your notes only. Each answers in its own column, with its own usage. A reply whose quotes cannot be verified, or that has no valid claims block, is discarded. You choose which reply, if any, to add to your note.',
  receives:'Your question and the notes you attach, after you approve the plan.',sendsOn:'The question to each chosen provider. Each turn’s status and usage go to the ledger; the replies go to Council history, not the ledger.',
  fields:['council.outputBytes'],edges:['council-claude','council-codex','council-kiro'],source:['server/council.ts','shared/council.ts','src/chat/CouncilPanel.tsx']}),
 n({id:'council-claude',label:'Council: Claude',kind:'editable',group:'council',x:1392,y:72,provider:'claude',
  does:'Claude answers inside Aitiarch’s no-tools fence. Spending is checked after the turn, and the deadline is the only hard stop: if Claude reports a cost over the cap, its answer is discarded.',
  receives:'The Council question and notes.',sendsOn:'Its reply and usage to the ledger.',
  fields:['council.caps.claude.amount','council.caps.claude.deadlineMs'],edges:['ledger'],source:['server/council.ts','shared/council.ts','src/chat/council-view.ts']}),
 n({id:'council-codex',label:'Council: Codex',kind:'editable',group:'council',x:1392,y:200,provider:'codex',
  does:'Codex runs with its tools switched off, in an empty scratch folder. Any tool action ends the turn; up to three blocked code attempts are tolerated and counted. Read-only is containment, not a no-read guarantee. Exactly Codex 0.167.0 is required. Spending is checked after the turn and the deadline is the only hard stop: an overrun keeps the answer and revokes the approval.',
  receives:'The Council question and notes.',sendsOn:'Its reply and usage to the ledger.',
  fields:['council.caps.codex.amount','council.caps.codex.deadlineMs'],edges:['ledger'],source:['server/council.ts','shared/council.ts','src/chat/council-view.ts']}),
 n({id:'council-kiro',label:'Council: Kiro',kind:'editable',group:'council',x:1392,y:328,provider:'kiro',
  does:'Aitiarch refuses every permission request Kiro makes. The turn ends on any tool attempt, and Kiro\'s tool list must be empty. Spending is checked after the turn and the deadline is the only hard stop: an overrun keeps the answer and revokes the approval.',
  receives:'The Council question and notes.',sendsOn:'Its reply and usage to the ledger.',
  fields:['council.caps.kiro.amount','council.caps.kiro.deadlineMs'],edges:['ledger'],source:['server/council.ts','shared/council.ts','src/chat/council-view.ts']}),
 n({id:'ledger',label:'Ledger',kind:'locked',group:'records',x:1664,y:392,lockedReason:'The ledger has no setting here: no key in the pipeline config touches it. It changes only by new events.',
  does:'Records that a request ran and whether it finished, with usage for Council and Investigate turns, the duration of Council turns, and which notes were read. It never records what was asked or answered.',
  receives:'Events from saved replies, Investigate turns and every Council provider.',sendsOn:'Nothing. It is the end of the flow.',
  fields:[],edges:[],source:['server/ledger-store.ts','server/chat/runtime.ts','server/council.ts']}),
]);

const BY_ID=new Map(PIPELINE_NODES.map(x=>[x.id,x]));
export const nodeById=(id:string|undefined|null):PipelineNode|undefined=>id?BY_ID.get(id):undefined;
export const lockedRule=(id:string)=>locked.find(l=>l.id===id);
/** Why a locked node is locked, in a sentence: the config's own sentence for its locked rule, or the node's own reason. Empty for an editable node. */
export function lockReason(node:PipelineNode):string{
 if(node.kind!=='locked')return '';
 return node.lockedBy?(lockedRule(node.lockedBy)?.description??''):(node.lockedReason??'');
}
/** The safety label a node carries, taken from the config in force (never stored here, so it cannot drift). Null for a node that is not a provider. */
export function safetyLabelOf(node:PipelineNode,config:Pick<PipelineConfig,'safetyLabels'>=DEFAULT_PIPELINE_CONFIG):PipelineSafetyLabel|null{
 return node.provider?config.safetyLabels[node.provider]:null;
}
/** The number at a dotted config path, or undefined. */
export function numberAt(config:unknown,key:string):number|undefined{
 let v=config as any;for(const k of key.split('.')){if(v==null||typeof v!=='object')return undefined;v=v[k];}
 return typeof v==='number'?v:undefined;
}
export const fieldsOf=(node:PipelineNode):FieldSpec[]=>node.fields.map(k=>FIELDS[k]).filter(Boolean);
export const edgesOf=():{from:string;to:string}[]=>PIPELINE_NODES.flatMap(x=>x.edges.map(to=>({from:x.id,to})));
