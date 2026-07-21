export namespace main {
	
	export class ActiveStreamSession {
	    active: boolean;
	    planId: string;
	    title: string;
	    seriesId: string;
	    episode: number;
	    startedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new ActiveStreamSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.active = source["active"];
	        this.planId = source["planId"];
	        this.title = source["title"];
	        this.seriesId = source["seriesId"];
	        this.episode = source["episode"];
	        this.startedAt = source["startedAt"];
	    }
	}
	export class AppSkill {
	    id: string;
	    title: string;
	    description: string;
	    content: string;
	    overridden: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AppSkill(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.content = source["content"];
	        this.overridden = source["overridden"];
	    }
	}
	export class AuthPollResult {
	    status: string;
	    account: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new AuthPollResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.account = source["account"];
	        this.message = source["message"];
	    }
	}
	export class BrandAsset {
	    id: string;
	    name: string;
	    description: string;
	    sizeBytes: number;
	    addedAt: string;
	    mediaUrl: string;
	
	    static createFrom(source: any = {}) {
	        return new BrandAsset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.sizeBytes = source["sizeBytes"];
	        this.addedAt = source["addedAt"];
	        this.mediaUrl = source["mediaUrl"];
	    }
	}
	export class BrandLink {
	    id: string;
	    label: string;
	    url: string;
	    iconFile: string;
	    addedAt: string;
	    iconUrl: string;
	
	    static createFrom(source: any = {}) {
	        return new BrandLink(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.url = source["url"];
	        this.iconFile = source["iconFile"];
	        this.addedAt = source["addedAt"];
	        this.iconUrl = source["iconUrl"];
	    }
	}
	export class BroadcastSendResult {
	    platform: string;
	    sent: boolean;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new BroadcastSendResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.sent = source["sent"];
	        this.error = source["error"];
	    }
	}
	export class ChannelMetrics {
	    platform: string;
	    audience: number;
	    supporters: number;
	    likes: number;
	    content: number;
	    views: number;
	
	    static createFrom(source: any = {}) {
	        return new ChannelMetrics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.audience = source["audience"];
	        this.supporters = source["supporters"];
	        this.likes = source["likes"];
	        this.content = source["content"];
	        this.views = source["views"];
	    }
	}
	export class ChannelSource {
	    title: string;
	    url: string;
	    account: string;
	
	    static createFrom(source: any = {}) {
	        return new ChannelSource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.url = source["url"];
	        this.account = source["account"];
	    }
	}
	export class ChatMessage {
	    id: string;
	    platform: string;
	    author: string;
	    authorId: string;
	    avatarUrl: string;
	    badges: string[];
	    text: string;
	    publishedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new ChatMessage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.platform = source["platform"];
	        this.author = source["author"];
	        this.authorId = source["authorId"];
	        this.avatarUrl = source["avatarUrl"];
	        this.badges = source["badges"];
	        this.text = source["text"];
	        this.publishedAt = source["publishedAt"];
	    }
	}
	export class DetailItem {
	    label: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new DetailItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.value = source["value"];
	    }
	}
	export class ChatUserInfo {
	    platform: string;
	    id: string;
	    displayName: string;
	    avatarUrl: string;
	    description: string;
	    createdAt: string;
	    channelUrl: string;
	    follower: string;
	    followedAt: string;
	    subscriber: string;
	    subTier: string;
	    details: DetailItem[];
	
	    static createFrom(source: any = {}) {
	        return new ChatUserInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.id = source["id"];
	        this.displayName = source["displayName"];
	        this.avatarUrl = source["avatarUrl"];
	        this.description = source["description"];
	        this.createdAt = source["createdAt"];
	        this.channelUrl = source["channelUrl"];
	        this.follower = source["follower"];
	        this.followedAt = source["followedAt"];
	        this.subscriber = source["subscriber"];
	        this.subTier = source["subTier"];
	        this.details = this.convertValues(source["details"], DetailItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ClipIdea {
	    title: string;
	    hook: string;
	    script: string;
	
	    static createFrom(source: any = {}) {
	        return new ClipIdea(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.hook = source["hook"];
	        this.script = source["script"];
	    }
	}
	export class ClipIdeaSet {
	    startedAt: string;
	    format: string;
	    generatedAt: string;
	    model: string;
	    ideas: ClipIdea[];
	
	    static createFrom(source: any = {}) {
	        return new ClipIdeaSet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startedAt = source["startedAt"];
	        this.format = source["format"];
	        this.generatedAt = source["generatedAt"];
	        this.model = source["model"];
	        this.ideas = this.convertValues(source["ideas"], ClipIdea);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ServiceCategory {
	    id: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new ServiceCategory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class ContentSeries {
	    id: string;
	    title: string;
	    description: string;
	    twitchCategory: ServiceCategory;
	    youtubeCategory: ServiceCategory;
	    kickCategory: ServiceCategory;
	    tags: string[];
	    notes: string;
	    season: string;
	    twitchLabels: string[];
	    youtubeMadeForKids: boolean;
	    createdAt: string;
	    isDefault: boolean;
	    typeId: string;
	
	    static createFrom(source: any = {}) {
	        return new ContentSeries(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.twitchCategory = this.convertValues(source["twitchCategory"], ServiceCategory);
	        this.youtubeCategory = this.convertValues(source["youtubeCategory"], ServiceCategory);
	        this.kickCategory = this.convertValues(source["kickCategory"], ServiceCategory);
	        this.tags = source["tags"];
	        this.notes = source["notes"];
	        this.season = source["season"];
	        this.twitchLabels = source["twitchLabels"];
	        this.youtubeMadeForKids = source["youtubeMadeForKids"];
	        this.createdAt = source["createdAt"];
	        this.isDefault = source["isDefault"];
	        this.typeId = source["typeId"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DebugReport {
	    id: number;
	    title: string;
	    description: string;
	    route: string;
	    global: boolean;
	    checkedOut: boolean;
	    issueUrl: string;
	    issueNumber: number;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new DebugReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.route = source["route"];
	        this.global = source["global"];
	        this.checkedOut = source["checkedOut"];
	        this.issueUrl = source["issueUrl"];
	        this.issueNumber = source["issueNumber"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	
	export class FixNotice {
	    id: number;
	    reportId: number;
	    title: string;
	    description: string;
	    route: string;
	    issueUrl: string;
	    issueNumber: number;
	    resolvedAt: string;

	    static createFrom(source: any = {}) {
	        return new FixNotice(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.reportId = source["reportId"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.route = source["route"];
	        this.issueUrl = source["issueUrl"];
	        this.issueNumber = source["issueNumber"];
	        this.resolvedAt = source["resolvedAt"];
	    }
	}

	export class GitHubConnection {
	    connected: boolean;
	    account: string;
	    repo: string;

	    static createFrom(source: any = {}) {
	        return new GitHubConnection(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connected = source["connected"];
	        this.account = source["account"];
	        this.repo = source["repo"];
	    }
	}

	export class DeviceCodeInfo {
	    deviceCode: string;
	    userCode: string;
	    verificationUri: string;
	    interval: number;
	    expiresIn: number;
	
	    static createFrom(source: any = {}) {
	        return new DeviceCodeInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.deviceCode = source["deviceCode"];
	        this.userCode = source["userCode"];
	        this.verificationUri = source["verificationUri"];
	        this.interval = source["interval"];
	        this.expiresIn = source["expiresIn"];
	    }
	}
	export class DownloadedVideo {
	    id: string;
	    title: string;
	    platform: string;
	    channelName: string;
	    startedAt: string;
	    durationSecs: number;
	    viewCount: number;
	    thumbnailUrl: string;
	    urls: string[];
	    subfolder: string;
	    videoFile: string;
	    downloadedAt: string;
	    mediaUrl: string;
	
	    static createFrom(source: any = {}) {
	        return new DownloadedVideo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.platform = source["platform"];
	        this.channelName = source["channelName"];
	        this.startedAt = source["startedAt"];
	        this.durationSecs = source["durationSecs"];
	        this.viewCount = source["viewCount"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.urls = source["urls"];
	        this.subfolder = source["subfolder"];
	        this.videoFile = source["videoFile"];
	        this.downloadedAt = source["downloadedAt"];
	        this.mediaUrl = source["mediaUrl"];
	    }
	}
	export class EditOutput {
	    name: string;
	    mediaUrl: string;
	    modifiedAt: string;
	    sizeBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new EditOutput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.mediaUrl = source["mediaUrl"];
	        this.modifiedAt = source["modifiedAt"];
	        this.sizeBytes = source["sizeBytes"];
	    }
	}
	export class EditRequest {
	    at: string;
	    kind: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new EditRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.at = source["at"];
	        this.kind = source["kind"];
	        this.text = source["text"];
	    }
	}
	export class EditSource {
	    startedAt: string;
	    title: string;
	    episodeNumber: number;
	    file: string;
	    mediaUrl: string;
	    downloaded: boolean;
	    hasTranscript: boolean;
	    subfolder: string;
	
	    static createFrom(source: any = {}) {
	        return new EditSource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startedAt = source["startedAt"];
	        this.title = source["title"];
	        this.episodeNumber = source["episodeNumber"];
	        this.file = source["file"];
	        this.mediaUrl = source["mediaUrl"];
	        this.downloaded = source["downloaded"];
	        this.hasTranscript = source["hasTranscript"];
	        this.subfolder = source["subfolder"];
	    }
	}
	export class EditRun {
	    startedAt: string;
	    endedAt: string;
	    durationSecs: number;
	    error?: string;

	    static createFrom(source: any = {}) {
	        return new EditRun(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startedAt = source["startedAt"];
	        this.endedAt = source["endedAt"];
	        this.durationSecs = source["durationSecs"];
	        this.error = source["error"];
	    }
	}

	export class EditVersion {
	    name: string;
	    mediaUrl: string;
	    modifiedAt: string;
	    sizeBytes: number;
	    hasCuts: boolean;
	    legacy: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EditVersion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.mediaUrl = source["mediaUrl"];
	        this.modifiedAt = source["modifiedAt"];
	        this.sizeBytes = source["sizeBytes"];
	        this.hasCuts = source["hasCuts"];
	        this.legacy = source["legacy"];
	    }
	}
	export class EditWorkspaceInfo {
	    planId: string;
	    dir: string;
	    prepared: boolean;
	    sources: EditSource[];
	    outputs: EditOutput[];
	    running: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EditWorkspaceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.planId = source["planId"];
	        this.dir = source["dir"];
	        this.prepared = source["prepared"];
	        this.sources = this.convertValues(source["sources"], EditSource);
	        this.outputs = this.convertValues(source["outputs"], EditOutput);
	        this.running = source["running"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class EditorTools {
	    git: boolean;
	    ffmpeg: boolean;
	    python: boolean;
	    claude: boolean;
	    node: string;
	    videoUse: boolean;
	    videoUseDir: string;
	    ready: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EditorTools(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.git = source["git"];
	        this.ffmpeg = source["ffmpeg"];
	        this.python = source["python"];
	        this.claude = source["claude"];
	        this.node = source["node"];
	        this.videoUse = source["videoUse"];
	        this.videoUseDir = source["videoUseDir"];
	        this.ready = source["ready"];
	    }
	}
	export class FBPageInfo {
	    id: string;
	    name: string;
	    selected: boolean;
	    instagram: string;
	
	    static createFrom(source: any = {}) {
	        return new FBPageInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.selected = source["selected"];
	        this.instagram = source["instagram"];
	    }
	}
	export class KickChatIDs {
	    chatroomId: number;
	    channelId: number;
	
	    static createFrom(source: any = {}) {
	        return new KickChatIDs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.chatroomId = source["chatroomId"];
	        this.channelId = source["channelId"];
	    }
	}
	export class LiveEvent {
	    id: string;
	    platform: string;
	    type: string;
	    author: string;
	    detail: string;
	    publishedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new LiveEvent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.platform = source["platform"];
	        this.type = source["type"];
	        this.author = source["author"];
	        this.detail = source["detail"];
	        this.publishedAt = source["publishedAt"];
	    }
	}
	export class LiveChatPage {
	    live: boolean;
	    messages: ChatMessage[];
	    events: LiveEvent[];
	    nextPageToken: string;
	    pollIntervalMs: number;
	
	    static createFrom(source: any = {}) {
	        return new LiveChatPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.live = source["live"];
	        this.messages = this.convertValues(source["messages"], ChatMessage);
	        this.events = this.convertValues(source["events"], LiveEvent);
	        this.nextPageToken = source["nextPageToken"];
	        this.pollIntervalMs = source["pollIntervalMs"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class LiveStream {
	    platform: string;
	    live: boolean;
	    error: string;
	    channelName: string;
	    channelLogin: string;
	    channelUrl: string;
	    streamUrl: string;
	    title: string;
	    category: string;
	    viewerCount: number;
	    startedAt: string;
	    thumbnailUrl: string;
	    avatarUrl: string;
	    bannerUrl: string;
	    details: DetailItem[];
	
	    static createFrom(source: any = {}) {
	        return new LiveStream(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.live = source["live"];
	        this.error = source["error"];
	        this.channelName = source["channelName"];
	        this.channelLogin = source["channelLogin"];
	        this.channelUrl = source["channelUrl"];
	        this.streamUrl = source["streamUrl"];
	        this.title = source["title"];
	        this.category = source["category"];
	        this.viewerCount = source["viewerCount"];
	        this.startedAt = source["startedAt"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.avatarUrl = source["avatarUrl"];
	        this.bannerUrl = source["bannerUrl"];
	        this.details = this.convertValues(source["details"], DetailItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LiveStreamMeta {
	    seriesId: string;
	    episodeNumber: number;
	    episodeDescription: string;
	
	    static createFrom(source: any = {}) {
	        return new LiveStreamMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.seriesId = source["seriesId"];
	        this.episodeNumber = source["episodeNumber"];
	        this.episodeDescription = source["episodeDescription"];
	    }
	}
	export class MCPTargetStatus {
	    name: string;
	    installed: boolean;
	    configured: boolean;
	    current: boolean;
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new MCPTargetStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.installed = source["installed"];
	        this.configured = source["configured"];
	        this.current = source["current"];
	        this.path = source["path"];
	    }
	}
	export class MCPStatus {
	    token: string;
	    running: boolean;
	    toolCount: number;
	    claudeCode: MCPTargetStatus;
	    claudeDesktop: MCPTargetStatus;
	
	    static createFrom(source: any = {}) {
	        return new MCPStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.token = source["token"];
	        this.running = source["running"];
	        this.toolCount = source["toolCount"];
	        this.claudeCode = this.convertValues(source["claudeCode"], MCPTargetStatus);
	        this.claudeDesktop = this.convertValues(source["claudeDesktop"], MCPTargetStatus);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class MetricTotals {
	    audience: number;
	    supporters: number;
	    likes: number;
	    content: number;
	    views: number;
	
	    static createFrom(source: any = {}) {
	        return new MetricTotals(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.audience = source["audience"];
	        this.supporters = source["supporters"];
	        this.likes = source["likes"];
	        this.content = source["content"];
	        this.views = source["views"];
	    }
	}
	export class MetricsDay {
	    day: string;
	    audience: number;
	    supporters: number;
	    likes: number;
	    content: number;
	    views: number;
	
	    static createFrom(source: any = {}) {
	        return new MetricsDay(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.day = source["day"];
	        this.audience = source["audience"];
	        this.supporters = source["supporters"];
	        this.likes = source["likes"];
	        this.content = source["content"];
	        this.views = source["views"];
	    }
	}
	export class MetricsSnapshot {
	    day: string;
	    totals: MetricTotals;
	    platforms: ChannelMetrics[];
	    previous: MetricTotals;
	    growth: MetricTotals;
	    hasHistory: boolean;
	    platformGrowth: ChannelMetrics[];

	    static createFrom(source: any = {}) {
	        return new MetricsSnapshot(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.day = source["day"];
	        this.totals = this.convertValues(source["totals"], MetricTotals);
	        this.platforms = this.convertValues(source["platforms"], ChannelMetrics);
	        this.previous = this.convertValues(source["previous"], MetricTotals);
	        this.growth = this.convertValues(source["growth"], MetricTotals);
	        this.hasHistory = source["hasHistory"];
	        this.platformGrowth = this.convertValues(source["platformGrowth"], ChannelMetrics);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class OutlineItem {
	    at: string;
	    title: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new OutlineItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.at = source["at"];
	        this.title = source["title"];
	        this.note = source["note"];
	    }
	}
	export class PastBroadcast {
	    platform: string;
	    title: string;
	    url: string;
	    thumbnailUrl: string;
	    startedAt: string;
	    duration: string;
	    durationSecs: number;
	    viewCount: number;
	    local: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PastBroadcast(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.title = source["title"];
	        this.url = source["url"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.startedAt = source["startedAt"];
	        this.duration = source["duration"];
	        this.durationSecs = source["durationSecs"];
	        this.viewCount = source["viewCount"];
	        this.local = source["local"];
	    }
	}
	export class StreamThumbInfo {
	    file: string;
	    url: string;
	    historyFiles: string[];
	    historyUrls: string[];
	    pushedFile: string;
	
	    static createFrom(source: any = {}) {
	        return new StreamThumbInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file = source["file"];
	        this.url = source["url"];
	        this.historyFiles = source["historyFiles"];
	        this.historyUrls = source["historyUrls"];
	        this.pushedFile = source["pushedFile"];
	    }
	}
	export class StreamPlanInfo {
	    planId: string;
	    title: string;
	    description: string;
	    channels: string[];
	    seriesId: string;
	    episodeNumber: number;
	    tags: string[];
	    thumbnailFile: string;
	    thumbnailUrl: string;
	    concludedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new StreamPlanInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.planId = source["planId"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.channels = source["channels"];
	        this.seriesId = source["seriesId"];
	        this.episodeNumber = source["episodeNumber"];
	        this.tags = source["tags"];
	        this.thumbnailFile = source["thumbnailFile"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.concludedAt = source["concludedAt"];
	    }
	}
	export class PastStream {
	    title: string;
	    customTitle: string;
	    thumbnailUrl: string;
	    startedAt: string;
	    totalViews: number;
	    groupId: string;
	    seriesId: string;
	    episodeNumber: number;
	    episodeDescription: string;
	    description: string;
	    descriptionPushed: string;
	    local: boolean;
	    broadcasts: PastBroadcast[];
	    plan?: StreamPlanInfo;
	    customThumb?: StreamThumbInfo;
	
	    static createFrom(source: any = {}) {
	        return new PastStream(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.customTitle = source["customTitle"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.startedAt = source["startedAt"];
	        this.totalViews = source["totalViews"];
	        this.groupId = source["groupId"];
	        this.seriesId = source["seriesId"];
	        this.episodeNumber = source["episodeNumber"];
	        this.episodeDescription = source["episodeDescription"];
	        this.description = source["description"];
	        this.descriptionPushed = source["descriptionPushed"];
	        this.local = source["local"];
	        this.broadcasts = this.convertValues(source["broadcasts"], PastBroadcast);
	        this.plan = this.convertValues(source["plan"], StreamPlanInfo);
	        this.customThumb = this.convertValues(source["customThumb"], StreamThumbInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PlanChanges {
	    requests: EditRequest[];
	    summary: string;
	    updatedAt: string;
	    appliedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new PlanChanges(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.requests = this.convertValues(source["requests"], EditRequest);
	        this.summary = source["summary"];
	        this.updatedAt = source["updatedAt"];
	        this.appliedAt = source["appliedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PlanChannelInfo {
	    channel: string;
	    connected: boolean;
	    matches: boolean;
	    currentTitle: string;
	    wantTitle: string;
	    detail?: string;
	    thumbnailStale: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PlanChannelInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.channel = source["channel"];
	        this.connected = source["connected"];
	        this.matches = source["matches"];
	        this.currentTitle = source["currentTitle"];
	        this.wantTitle = source["wantTitle"];
	        this.detail = source["detail"];
	        this.thumbnailStale = source["thumbnailStale"];
	    }
	}
	export class PlanSessionInfo {
	    planId: string;
	    startedAt: string;
	    endedAt: string;
	    matched: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PlanSessionInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.planId = source["planId"];
	        this.startedAt = source["startedAt"];
	        this.endedAt = source["endedAt"];
	        this.matched = source["matched"];
	    }
	}
	export class PlanWorkspaceDirs {
	    dir: string;
	    sources: string;

	    static createFrom(source: any = {}) {
	        return new PlanWorkspaceDirs(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dir = source["dir"];
	        this.sources = source["sources"];
	    }
	}

	export class PlanSuggestion {
	    title: string;
	    description: string;
	    tags: string[];
	
	    static createFrom(source: any = {}) {
	        return new PlanSuggestion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.description = source["description"];
	        this.tags = source["tags"];
	    }
	}
	export class PlanThumbnail {
	    file: string;
	    url: string;
	
	    static createFrom(source: any = {}) {
	        return new PlanThumbnail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file = source["file"];
	        this.url = source["url"];
	    }
	}
	export class TimelineSegment {
	    start: number;
	    end: number;
	    source: string;
	    sourceStart: number;
	    sourceEnd: number;
	    padStart: number;
	    padEnd: number;
	    label: string;
	
	    static createFrom(source: any = {}) {
	        return new TimelineSegment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.source = source["source"];
	        this.sourceStart = source["sourceStart"];
	        this.sourceEnd = source["sourceEnd"];
	        this.padStart = source["padStart"];
	        this.padEnd = source["padEnd"];
	        this.label = source["label"];
	    }
	}
	export class PlanTimeline {
	    file: string;
	    segments: TimelineSegment[];
	    savedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new PlanTimeline(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file = source["file"];
	        this.segments = this.convertValues(source["segments"], TimelineSegment);
	        this.savedAt = source["savedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PlannedStream {
	    id: string;
	    title: string;
	    description: string;
	    channels: string[];
	    seriesId: string;
	    episodeNumber: number;
	    tags: string[];
	    thumbnailFile: string;
	    thumbnailUrl: string;
	    thumbnailHistory: string[];
	    thumbnailHistoryUrls: string[];
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new PlannedStream(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.channels = source["channels"];
	        this.seriesId = source["seriesId"];
	        this.episodeNumber = source["episodeNumber"];
	        this.tags = source["tags"];
	        this.thumbnailFile = source["thumbnailFile"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.thumbnailHistory = source["thumbnailHistory"];
	        this.thumbnailHistoryUrls = source["thumbnailHistoryUrls"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class PostStreamStatus {
	    active: boolean;
	    stage: string;
	    detail: string;
	    startedAt: string;
	    title: string;
	    warnings: string[];
	
	    static createFrom(source: any = {}) {
	        return new PostStreamStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.active = source["active"];
	        this.stage = source["stage"];
	        this.detail = source["detail"];
	        this.startedAt = source["startedAt"];
	        this.title = source["title"];
	        this.warnings = source["warnings"];
	    }
	}
	export class Profile {
	    name: string;
	    email: string;
	
	    static createFrom(source: any = {}) {
	        return new Profile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.email = source["email"];
	    }
	}
	export class ProjectChatMessage {
	    role: string;
	    text: string;

	    static createFrom(source: any = {}) {
	        return new ProjectChatMessage(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.text = source["text"];
	    }
	}
	export class ProjectChatReply {
	    reply: string;
	    description: string;

	    static createFrom(source: any = {}) {
	        return new ProjectChatReply(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.reply = source["reply"];
	        this.description = source["description"];
	    }
	}
	export class ProjectDoc {
	    id: string;
	    parentId: string;
	    title: string;
	    content: string;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectDoc(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.parentId = source["parentId"];
	        this.title = source["title"];
	        this.content = source["content"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class ProjectAsset {
	    id: string;
	    name: string;
	    description: string;
	    sizeBytes: number;
	    addedAt: string;
	    mediaUrl: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectAsset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.sizeBytes = source["sizeBytes"];
	        this.addedAt = source["addedAt"];
	        this.mediaUrl = source["mediaUrl"];
	    }
	}
	export class Project {
	    id: string;
	    title: string;
	    description: string;
	    repository: string;
	    thumbnailFile: string;
	    thumbnailUrl: string;
	    active: boolean;
	    createdAt: string;
	    assets: ProjectAsset[];
	    docs: ProjectDoc[];
	
	    static createFrom(source: any = {}) {
	        return new Project(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.repository = source["repository"];
	        this.thumbnailFile = source["thumbnailFile"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.active = source["active"];
	        this.createdAt = source["createdAt"];
	        this.assets = this.convertValues(source["assets"], ProjectAsset);
	        this.docs = this.convertValues(source["docs"], ProjectDoc);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class SponsorFile {
    id: string;
    name: string;
    sizeBytes: number;
    addedAt: string;
    mediaUrl: string;

    static createFrom(source: any = {}) {
        return new SponsorFile(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.name = source["name"];
        this.sizeBytes = source["sizeBytes"];
        this.addedAt = source["addedAt"];
        this.mediaUrl = source["mediaUrl"];
    }
}
export class SponsorCampaign {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    messaging: string;
    promotionDetails: string;
    assets: SponsorFile[];
    createdAt: string;

    static createFrom(source: any = {}) {
        return new SponsorCampaign(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.name = source["name"];
        this.startDate = source["startDate"];
        this.endDate = source["endDate"];
        this.messaging = source["messaging"];
        this.promotionDetails = source["promotionDetails"];
        this.assets = this.convertValues(source["assets"], SponsorFile);
        this.createdAt = source["createdAt"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (a.slice && a.map) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class InspirationChannel {
    id: string;
    name: string;
    handle: string;
    url: string;
    description: string;
    avatarUrl: string;
    bannerUrl: string;
    subscribers: number;
    videoCount: number;
    tags: string[];
    links: InspirationLink[];
    addedAt: string;
    indexedAt: string;

    static createFrom(source: any = {}) {
        return new InspirationChannel(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.name = source["name"];
        this.handle = source["handle"];
        this.url = source["url"];
        this.description = source["description"];
        this.avatarUrl = source["avatarUrl"];
        this.bannerUrl = source["bannerUrl"];
        this.subscribers = source["subscribers"];
        this.videoCount = source["videoCount"];
        this.tags = source["tags"];
        this.links = this.convertValues(source["links"], InspirationLink);
        this.addedAt = source["addedAt"];
        this.indexedAt = source["indexedAt"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (a.slice && a.map) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class InspirationChapter {
    title: string;
    startSecs: number;

    static createFrom(source: any = {}) {
        return new InspirationChapter(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.title = source["title"];
        this.startSecs = source["startSecs"];
    }
}
export class InspirationLine {
    atSecs: number;
    endSecs: number;
    text: string;

    static createFrom(source: any = {}) {
        return new InspirationLine(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.atSecs = source["atSecs"];
        this.endSecs = source["endSecs"];
        this.text = source["text"];
    }
}
export class InspirationBeat {
    atSecs: number;
    title: string;
    summary: string;

    static createFrom(source: any = {}) {
        return new InspirationBeat(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.atSecs = source["atSecs"];
        this.title = source["title"];
        this.summary = source["summary"];
    }
}
export class InspirationLink {
    label: string;
    url: string;

    static createFrom(source: any = {}) {
        return new InspirationLink(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.label = source["label"];
        this.url = source["url"];
    }
}
export class InspirationMention {
    kind: string;
    name: string;
    detail: string;
    atSecs: number;

    static createFrom(source: any = {}) {
        return new InspirationMention(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.kind = source["kind"];
        this.name = source["name"];
        this.detail = source["detail"];
        this.atSecs = source["atSecs"];
    }
}
export class InspirationSearchHit {
    videoId: string;
    title: string;
    url: string;
    channelId: string;
    channel: string;
    kind: string;
    atSecs: number;
    text: string;
    score: number;
    citation: string;

    static createFrom(source: any = {}) {
        return new InspirationSearchHit(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.videoId = source["videoId"];
        this.title = source["title"];
        this.url = source["url"];
        this.channelId = source["channelId"];
        this.channel = source["channel"];
        this.kind = source["kind"];
        this.atSecs = source["atSecs"];
        this.text = source["text"];
        this.score = source["score"];
        this.citation = source["citation"];
    }
}
export class InspirationTakeaway {
    kind: string;
    title: string;
    detail: string;
    apply: string;
    atSecs: number;

    static createFrom(source: any = {}) {
        return new InspirationTakeaway(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.kind = source["kind"];
        this.title = source["title"];
        this.detail = source["detail"];
        this.apply = source["apply"];
        this.atSecs = source["atSecs"];
    }
}
export class InspirationVideo {
    id: string;
    channelId: string;
    title: string;
    url: string;
    description: string;
    publishedAt: string;
    durationSecs: number;
    views: number;
    likes: number;
    comments: number;
    tags: string[];
    categories: string[];
    thumbnailUrl: string;
    thumbnailFile: string;
    folder: string;
    videoFile: string;
    mediaUrl: string;
    thumbUrl: string;
    status: string;
    statusDetail: string;
    progress: number;
    chapters: InspirationChapter[];
    transcript: InspirationLine[];
    summary: string;
    outline: string;
    beats: InspirationBeat[];
    links: InspirationLink[];
    mentions: InspirationMention[];
    takeaways: InspirationTakeaway[];
    takeawaysAt: string;
    addedAt: string;
    analyzedAt: string;

    static createFrom(source: any = {}) {
        return new InspirationVideo(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.channelId = source["channelId"];
        this.title = source["title"];
        this.url = source["url"];
        this.description = source["description"];
        this.publishedAt = source["publishedAt"];
        this.durationSecs = source["durationSecs"];
        this.views = source["views"];
        this.likes = source["likes"];
        this.comments = source["comments"];
        this.tags = source["tags"];
        this.categories = source["categories"];
        this.thumbnailUrl = source["thumbnailUrl"];
        this.thumbnailFile = source["thumbnailFile"];
        this.folder = source["folder"];
        this.videoFile = source["videoFile"];
        this.mediaUrl = source["mediaUrl"];
        this.thumbUrl = source["thumbUrl"];
        this.status = source["status"];
        this.statusDetail = source["statusDetail"];
        this.progress = source["progress"];
        this.chapters = this.convertValues(source["chapters"], InspirationChapter);
        this.transcript = this.convertValues(source["transcript"], InspirationLine);
        this.summary = source["summary"];
        this.outline = source["outline"];
        this.beats = this.convertValues(source["beats"], InspirationBeat);
        this.links = this.convertValues(source["links"], InspirationLink);
        this.mentions = this.convertValues(source["mentions"], InspirationMention);
        this.takeaways = this.convertValues(source["takeaways"], InspirationTakeaway);
        this.takeawaysAt = source["takeawaysAt"];
        this.addedAt = source["addedAt"];
        this.analyzedAt = source["analyzedAt"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (a.slice && a.map) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}
export class Sponsor {
    id: string;
    name: string;
    website: string;
    description: string;
    selfPromotion: boolean;
    logoFileId: string;
    logoUrl: string;
    branding: SponsorFile[];
    campaigns: SponsorCampaign[];
    createdAt: string;

    static createFrom(source: any = {}) {
        return new Sponsor(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.name = source["name"];
        this.website = source["website"];
        this.description = source["description"];
        this.selfPromotion = source["selfPromotion"];
        this.logoFileId = source["logoFileId"];
        this.logoUrl = source["logoUrl"];
        this.branding = this.convertValues(source["branding"], SponsorFile);
        this.campaigns = this.convertValues(source["campaigns"], SponsorCampaign);
        this.createdAt = source["createdAt"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (a.slice && a.map) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}


export class WidgetFieldType {
    id: string;
    name: string;
    kind: string;
    maxLength: number;
    createdAt: string;

    static createFrom(source: any = {}) {
        return new WidgetFieldType(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.name = source["name"];
        this.kind = source["kind"];
        this.maxLength = source["maxLength"];
        this.createdAt = source["createdAt"];
    }
}

export class WidgetField {
    id: string;
    typeId: string;
    label: string;
    value: string;
    valueUrl: string;

    static createFrom(source: any = {}) {
        return new WidgetField(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.typeId = source["typeId"];
        this.label = source["label"];
        this.value = source["value"];
        this.valueUrl = source["valueUrl"];
    }
}
export class WidgetItem {
    id: string;
    values: Record<string, string>;
    createdAt: string;

    static createFrom(source: any = {}) {
        return new WidgetItem(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.values = source["values"];
        this.createdAt = source["createdAt"];
    }
}
export class StreamWidget {
    id: string;
    name: string;
    fields: WidgetField[];
    items: WidgetItem[];
    template: string;
    css: string;
    js: string;
    createdAt: string;
    sourceUrl: string;

    static createFrom(source: any = {}) {
        return new StreamWidget(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.name = source["name"];
        this.fields = this.convertValues(source["fields"], WidgetField);
        this.items = this.convertValues(source["items"], WidgetItem);
        this.template = source["template"];
        this.css = source["css"];
        this.js = source["js"];
        this.createdAt = source["createdAt"];
        this.sourceUrl = source["sourceUrl"];
    }

	convertValues(a: any, classs: any, asMap: boolean = false): any {
	    if (!a) {
	        return a;
	    }
	    if (a.slice && a.map) {
	        return (a as any[]).map(elem => this.convertValues(elem, classs));
	    } else if ("object" === typeof a) {
	        if (asMap) {
	            for (const key of Object.keys(a)) {
	                a[key] = new classs(a[key]);
	            }
	            return a;
	        }
	        return new classs(a);
	    }
	    return a;
	}
}

export class SystemWidget {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    sourceUrl: string;

    static createFrom(source: any = {}) {
        return new SystemWidget(source);
    }

    constructor(source: any = {}) {
        if ('string' === typeof source) source = JSON.parse(source);
        this.id = source["id"];
        this.name = source["name"];
        this.description = source["description"];
        this.enabled = source["enabled"];
        this.sourceUrl = source["sourceUrl"];
    }
}

export class RoutineStep {
	    kind: string;
	    scene?: string;
	    target?: string;
	    source?: string;
	    sceneItemId?: number;
	    mode?: string;
	    delayMs?: number;
	    vkey?: number;
	    ctrl?: boolean;
	    shift?: boolean;
	    alt?: boolean;
	    win?: boolean;
	    streamdeckActionId?: string;
	    description?: string;
	
	    static createFrom(source: any = {}) {
	        return new RoutineStep(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.scene = source["scene"];
	        this.target = source["target"];
	        this.source = source["source"];
	        this.sceneItemId = source["sceneItemId"];
	        this.mode = source["mode"];
	        this.delayMs = source["delayMs"];
	        this.vkey = source["vkey"];
	        this.ctrl = source["ctrl"];
	        this.shift = source["shift"];
	        this.alt = source["alt"];
	        this.win = source["win"];
	        this.streamdeckActionId = source["streamdeckActionId"];
	        this.description = source["description"];
	    }
	}
	export class Routine {
	    id: string;
	    name: string;
	    trigger: string;
	    builtIn: boolean;
	    manager?: string;
	    streamdeckActionId?: string;
	    streamdeckTitle?: string;
	    streamdeckAfterActionId?: string;
	    streamdeckAfterTitle?: string;
	    steps: RoutineStep[];
	    afterSteps: RoutineStep[];
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Routine(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.trigger = source["trigger"];
	        this.builtIn = source["builtIn"];
	        this.manager = source["manager"];
	        this.streamdeckActionId = source["streamdeckActionId"];
	        this.streamdeckTitle = source["streamdeckTitle"];
	        this.streamdeckAfterActionId = source["streamdeckAfterActionId"];
	        this.streamdeckAfterTitle = source["streamdeckAfterTitle"];
	        this.steps = this.convertValues(source["steps"], RoutineStep);
	        this.afterSteps = this.convertValues(source["afterSteps"], RoutineStep);
	        this.createdAt = source["createdAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class SeriesType {
	    id: string;
	    title: string;
	    episodic: boolean;
	    description: string;
	    createdAt: string;
	    isDefault: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SeriesType(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.episodic = source["episodic"];
	        this.description = source["description"];
	        this.createdAt = source["createdAt"];
	        this.isDefault = source["isDefault"];
	    }
	}
	
	export class ServiceConfig {
	    twitchClientId: string;
	    youtubeClientId: string;
	    youtubeClientSecret: string;
	    kickClientId: string;
	    kickClientSecret: string;
	    facebookAppId: string;
	    facebookClientToken: string;
	    xClientId: string;
	    xClientSecret: string;
	    tiktokClientKey: string;
	    tiktokClientSecret: string;
	    obsHost: string;
	    obsPort: string;
	    obsPassword: string;
	    obsAutoConnect: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ServiceConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.twitchClientId = source["twitchClientId"];
	        this.youtubeClientId = source["youtubeClientId"];
	        this.youtubeClientSecret = source["youtubeClientSecret"];
	        this.kickClientId = source["kickClientId"];
	        this.kickClientSecret = source["kickClientSecret"];
	        this.facebookAppId = source["facebookAppId"];
	        this.facebookClientToken = source["facebookClientToken"];
	        this.xClientId = source["xClientId"];
	        this.xClientSecret = source["xClientSecret"];
	        this.tiktokClientKey = source["tiktokClientKey"];
	        this.tiktokClientSecret = source["tiktokClientSecret"];
	        this.obsHost = source["obsHost"];
	        this.obsPort = source["obsPort"];
	        this.obsPassword = source["obsPassword"];
	        this.obsAutoConnect = source["obsAutoConnect"];
	    }
	}
	export class ServiceStatus {
	    name: string;
	    connected: boolean;
	    account: string;
	
	    static createFrom(source: any = {}) {
	        return new ServiceStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.connected = source["connected"];
	        this.account = source["account"];
	    }
	}
	export class StoredChatMessage {
	    platform: string;
	    id: string;
	    author: string;
	    authorId: string;
	    authorLogin: string;
	    avatarUrl: string;
	    badges: string[];
	    color: string;
	    text: string;
	    richText: string;
	    at: number;
	    read: boolean;
	
	    static createFrom(source: any = {}) {
	        return new StoredChatMessage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.id = source["id"];
	        this.author = source["author"];
	        this.authorId = source["authorId"];
	        this.authorLogin = source["authorLogin"];
	        this.avatarUrl = source["avatarUrl"];
	        this.badges = source["badges"];
	        this.color = source["color"];
	        this.text = source["text"];
	        this.richText = source["richText"];
	        this.at = source["at"];
	        this.read = source["read"];
	    }
	}
	export class StoredLiveEvent {
	    platform: string;
	    id: string;
	    type: string;
	    author: string;
	    detail: string;
	    at: number;
	    read: boolean;
	
	    static createFrom(source: any = {}) {
	        return new StoredLiveEvent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.id = source["id"];
	        this.type = source["type"];
	        this.author = source["author"];
	        this.detail = source["detail"];
	        this.at = source["at"];
	        this.read = source["read"];
	    }
	}
	export class Stream {
	    title: string;
	    description: string;
	    channelSource: ChannelSource;
	    plan: string;
	
	    static createFrom(source: any = {}) {
	        return new Stream(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.description = source["description"];
	        this.channelSource = this.convertValues(source["channelSource"], ChannelSource);
	        this.plan = source["plan"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class StreamOutline {
	    startedAt: string;
	    generatedAt: string;
	    model: string;
	    summary: string;
	    items: OutlineItem[];
	
	    static createFrom(source: any = {}) {
	        return new StreamOutline(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startedAt = source["startedAt"];
	        this.generatedAt = source["generatedAt"];
	        this.model = source["model"];
	        this.summary = source["summary"];
	        this.items = this.convertValues(source["items"], OutlineItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class StreamdeckMultiAction {
	    id: string;
	    title: string;
	    profile: string;
	    coordinates: string;
	    steps: RoutineStep[];
	
	    static createFrom(source: any = {}) {
	        return new StreamdeckMultiAction(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.profile = source["profile"];
	        this.coordinates = source["coordinates"];
	        this.steps = this.convertValues(source["steps"], RoutineStep);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TikTokPublishRecord {
	    publishId: string;
	    url: string;
	    title: string;
	    file: string;
	    publishedAt: string;
	    privacy: string;
	    warning: string;
	
	    static createFrom(source: any = {}) {
	        return new TikTokPublishRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.publishId = source["publishId"];
	        this.url = source["url"];
	        this.title = source["title"];
	        this.file = source["file"];
	        this.publishedAt = source["publishedAt"];
	        this.privacy = source["privacy"];
	        this.warning = source["warning"];
	    }
	}
	
	export class Video {
	    platform: string;
	    id: string;
	    title: string;
	    description: string;
	    url: string;
	    thumbnailUrl: string;
	    publishedAt: string;
	    duration: string;
	    durationSecs: number;
	    viewCount: number;
	    kind: string;
	    status: string;
	    channelName: string;
	    isShort: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Video(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.platform = source["platform"];
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.url = source["url"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.publishedAt = source["publishedAt"];
	        this.duration = source["duration"];
	        this.durationSecs = source["durationSecs"];
	        this.viewCount = source["viewCount"];
	        this.kind = source["kind"];
	        this.status = source["status"];
	        this.channelName = source["channelName"];
	        this.isShort = source["isShort"];
	    }
	}
	export class TrackedShare {
	    url: string;
	    platform: string;
	    source: string;
	    video?: Video;
	
	    static createFrom(source: any = {}) {
	        return new TrackedShare(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.platform = source["platform"];
	        this.source = source["source"];
	        this.video = this.convertValues(source["video"], Video);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class VideoPublishRecord {
	    videoId: string;
	    url: string;
	    title: string;
	    file: string;
	    publishedAt: string;
	    thumbPushed: boolean;
	    warning: string;
	
	    static createFrom(source: any = {}) {
	        return new VideoPublishRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.videoId = source["videoId"];
	        this.url = source["url"];
	        this.title = source["title"];
	        this.file = source["file"];
	        this.publishedAt = source["publishedAt"];
	        this.thumbPushed = source["thumbPushed"];
	        this.warning = source["warning"];
	    }
	}
	export class VideoPlanStream {
	    startedAt: string;
	    title: string;
	
	    static createFrom(source: any = {}) {
	        return new VideoPlanStream(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startedAt = source["startedAt"];
	        this.title = source["title"];
	    }
	}
	export class VideoPlan {
	    id: string;
	    title: string;
	    description: string;
	    format: string;
	    tags: string[];
	    streams: VideoPlanStream[];
	    files: string[];
	    fileUrls: string[];
	    thumbnailFile: string;
	    thumbnailUrl: string;
	    thumbnailHistory: string[];
	    thumbnailHistoryUrls: string[];
	    createdAt: string;
	    status: string;
	    completedAt: string;
	    shareUrls: string[];
	
	    static createFrom(source: any = {}) {
	        return new VideoPlan(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.format = source["format"];
	        this.tags = source["tags"];
	        this.streams = this.convertValues(source["streams"], VideoPlanStream);
	        this.files = source["files"];
	        this.fileUrls = source["fileUrls"];
	        this.thumbnailFile = source["thumbnailFile"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.thumbnailHistory = source["thumbnailHistory"];
	        this.thumbnailHistoryUrls = source["thumbnailHistoryUrls"];
	        this.createdAt = source["createdAt"];
	        this.status = source["status"];
	        this.completedAt = source["completedAt"];
	        this.shareUrls = source["shareUrls"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TrackedVideo {
	    plan: VideoPlan;
	    record?: VideoPublishRecord;
	    live?: Video;
	    shares: TrackedShare[];
	    totalViews: number;
	
	    static createFrom(source: any = {}) {
	        return new TrackedVideo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plan = this.convertValues(source["plan"], VideoPlan);
	        this.record = this.convertValues(source["record"], VideoPublishRecord);
	        this.live = this.convertValues(source["live"], Video);
	        this.shares = this.convertValues(source["shares"], TrackedShare);
	        this.totalViews = source["totalViews"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TranscribeJob {
	    subfolder: string;
	    state: string;
	
	    static createFrom(source: any = {}) {
	        return new TranscribeJob(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.subfolder = source["subfolder"];
	        this.state = source["state"];
	    }
	}
	export class TranscriptLineRec {
	    at: number;
	    endAt: number;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new TranscriptLineRec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.at = source["at"];
	        this.endAt = source["endAt"];
	        this.text = source["text"];
	    }
	}
	
	export class VideoComment {
	    author: string;
	    avatarUrl: string;
	    text: string;
	    likeCount: number;
	    replyCount: number;
	    publishedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new VideoComment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.author = source["author"];
	        this.avatarUrl = source["avatarUrl"];
	        this.text = source["text"];
	        this.likeCount = source["likeCount"];
	        this.replyCount = source["replyCount"];
	        this.publishedAt = source["publishedAt"];
	    }
	}
	export class VideoDetails {
	    video: Video;
	    stats: DetailItem[];
	    comments: VideoComment[];
	    commentsNote: string;
	    fetchedAt: string;
	    fromCache: boolean;
	
	    static createFrom(source: any = {}) {
	        return new VideoDetails(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.video = this.convertValues(source["video"], Video);
	        this.stats = this.convertValues(source["stats"], DetailItem);
	        this.comments = this.convertValues(source["comments"], VideoComment);
	        this.commentsNote = source["commentsNote"];
	        this.fetchedAt = source["fetchedAt"];
	        this.fromCache = source["fromCache"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class VideoList {
	    videos: Video[];
	    fetchedAt: string;
	    fromCache: boolean;
	
	    static createFrom(source: any = {}) {
	        return new VideoList(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.videos = this.convertValues(source["videos"], Video);
	        this.fetchedAt = source["fetchedAt"];
	        this.fromCache = source["fromCache"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class VideoPublishDraft {
	    output: string;
	    title: string;
	    description: string;
	    tags: string[];
	    categoryId: string;
	    privacy: string;
	
	    static createFrom(source: any = {}) {
	        return new VideoPublishDraft(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.output = source["output"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.tags = source["tags"];
	        this.categoryId = source["categoryId"];
	        this.privacy = source["privacy"];
	    }
	}
	
	export class VideoPublishState {
	    draft?: VideoPublishDraft;
	    record?: VideoPublishRecord;
	    publishing: boolean;
	    defaultCategoryId: string;
	
	    static createFrom(source: any = {}) {
	        return new VideoPublishState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.draft = this.convertValues(source["draft"], VideoPublishDraft);
	        this.record = this.convertValues(source["record"], VideoPublishRecord);
	        this.publishing = source["publishing"];
	        this.defaultCategoryId = source["defaultCategoryId"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class VideoPublishSuggestion {
	    title: string;
	    description: string;
	    tags: string[];
	    categoryId: string;
	
	    static createFrom(source: any = {}) {
	        return new VideoPublishSuggestion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.description = source["description"];
	        this.tags = source["tags"];
	        this.categoryId = source["categoryId"];
	    }
	}
	export class YouTubePushResult {
	    title: string;
	    descriptionPushed: boolean;
	    thumbnailPushed: boolean;
	    thumb: StreamThumbInfo;
	    warning: string;
	
	    static createFrom(source: any = {}) {
	        return new YouTubePushResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.descriptionPushed = source["descriptionPushed"];
	        this.thumbnailPushed = source["thumbnailPushed"];
	        this.thumb = this.convertValues(source["thumb"], StreamThumbInfo);
	        this.warning = source["warning"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

