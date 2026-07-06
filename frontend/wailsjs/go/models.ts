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
	    tags: string[];
	    notes: string;
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
	        this.tags = source["tags"];
	        this.notes = source["notes"];
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
	    }
	}
	export class PastStream {
	    title: string;
	    thumbnailUrl: string;
	    startedAt: string;
	    totalViews: number;
	    groupId: string;
	    seriesId: string;
	    episodeNumber: number;
	    episodeDescription: string;
	    broadcasts: PastBroadcast[];
	
	    static createFrom(source: any = {}) {
	        return new PastStream(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.thumbnailUrl = source["thumbnailUrl"];
	        this.startedAt = source["startedAt"];
	        this.totalViews = source["totalViews"];
	        this.groupId = source["groupId"];
	        this.seriesId = source["seriesId"];
	        this.episodeNumber = source["episodeNumber"];
	        this.episodeDescription = source["episodeDescription"];
	        this.broadcasts = this.convertValues(source["broadcasts"], PastBroadcast);
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
	export class PlannedStream {
	    id: string;
	    title: string;
	    description: string;
	    channels: string[];
	    seriesId: string;
	    episodeNumber: number;
	    tags: string[];
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
	        this.createdAt = source["createdAt"];
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
	
	
	export class RoutineStep {
	    kind: string;
	    scene?: string;
	    target?: string;
	    source?: string;
	    sceneItemId?: number;
	    mode?: string;
	    delayMs?: number;
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

}

