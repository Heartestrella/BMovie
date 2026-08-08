export const zhCN = {
  localeName: '简体中文',
  storage: {
    title: '网盘存储', add: '添加', addStorage: '添加存储', cancel: '取消', driver: '存储类型',
    required: '必填', advanced: '驱动参数', save: '保存存储', saving: '正在保存…',
    loading: '正在读取配置…', emptyTitle: '还没有存储',
    emptyBody: '添加网盘或本地目录后，就可以浏览和播放其中的视频。', first: '添加第一个存储',
    delete: '删除', deleteConfirm: '确定删除存储“{path}”吗？', unknownStatus: '未知状态',
    missing: '请填写必填项：{field}', customFieldHelp: '此项由存储驱动提供，请按服务商要求填写。',
  },
  status: { work: '正常', working: '正常', disabled: '已停用', error: '异常', unknown: '未知' },
  option: {
    true: '开启', false: '关闭', asc: '升序', desc: '降序', name: '名称', size: '大小', modified: '修改时间',
    native_proxy: '本机代理', use_proxy_url: '使用代理地址', '302_redirect': '302 重定向',
    front: '前置', back: '后置', default: '默认', web: '网页', android: '安卓', ios: 'iOS', tv: '电视',
  },
} as const

export const driverNames: Record<string, string> = {
  '115 Cloud': '115 网盘', '115 Open': '115 开放平台', '115 Share': '115 分享',
  '123 Open': '123 云盘开放平台', '123Pan': '123 云盘', '123PanLink': '123 云盘直链', '123PanShare': '123 云盘分享',
  '139Yun': '中国移动云盘', '189Cloud': '天翼云盘', '189CloudPC': '天翼云盘（电脑端）', '189CloudTV': '天翼云盘（电视端）',
  AliDoc: '阿里文档', Aliyundrive: '阿里云盘', AliyundriveOpen: '阿里云盘开放平台', AliyundriveShare: '阿里云盘分享',
  Alias: '目录别名', AutoIndex: '自动索引', BaiduNetdisk: '百度网盘', BaiduPhoto: '一刻相册',
  'Azure Blob Storage': 'Azure 对象存储', 'Bunny Storage': 'Bunny 对象存储',
  ChaoXingGroupDrive: '超星小组云盘', Chunk: '分块存储', Cloudreve: 'Cloudreve 网盘', 'Cloudreve V4': 'Cloudreve V4 网盘',
  'CNB Releases': 'CNB 发行文件', Crypt: '加密存储', Degoo: 'Degoo 云盘', Doge: '多吉云',
  Doubao: '豆包云盘', DoubaoNew: '豆包云盘（新版）', DoubaoShare: '豆包分享', Dropbox: 'Dropbox 网盘',
  Emby: 'Emby 媒体库', FebBox: 'FebBox 网盘', FeijiPan: '小飞机网盘', FTP: 'FTP 服务器',
  'GitHub API': 'GitHub 接口', 'GitHub Releases': 'GitHub 发行文件', GoogleDrive: 'Google 云端硬盘', GooglePhoto: 'Google 相册',
  HalalCloud: '清真云盘', HalalCloudOpen: '清真云盘开放平台', ILanZou: '蓝奏云优享版', 'IPFS API': 'IPFS 接口',
  KodBox: '可道云', Lanzou: '蓝奏云', LenovoNasShare: '联想 NAS 分享', Local: '本地目录',
  MediaFire: 'MediaFire 网盘', MediaTrack: '媒体轨道', Mega_nz: 'MEGA 网盘', Misskey: 'Misskey 附件',
  MoPan: '中国移动云盘（新版）', NeteaseMusic: '网易云音乐', Onedrive: '微软 OneDrive', OnedriveAPP: '微软 OneDrive 应用',
  'Onedrive Sharelink': 'OneDrive 分享链接', OpenList: 'OpenList 存储', OpenListShare: 'OpenList 分享',
  PikPak: 'PikPak 网盘', PikPakShare: 'PikPak 分享', ProtonDrive: 'Proton Drive 网盘',
  Quark: '夸克网盘', QuarkOpen: '夸克开放平台', QuarkTV: '夸克网盘（电视端）',
  S3: 'S3 对象存储', Seafile: 'Seafile 网盘', SFTP: 'SFTP 服务器', SMB: '局域网共享（SMB）',
  Strm: 'STRM 媒体文件', Teambition: 'Teambition 网盘', Teldrive: 'Telegram 网盘', Terabox: 'TeraBox 网盘',
  Thunder: '迅雷云盘', ThunderBrowser: '迅雷云盘（浏览器）', ThunderBrowserExpert: '迅雷云盘（浏览器专家版）',
  ThunderExpert: '迅雷云盘（专家版）', ThunderX: '迅雷云盘 X', ThunderXExpert: '迅雷云盘 X 专家版',
  UC: 'UC 网盘', UCTV: 'UC 网盘（电视端）', UrlTree: '网址目录树', USS: '又拍云存储',
  Virtual: '虚拟目录', WebDav: 'WebDAV 服务器', WeiYun: '腾讯微云', WoPan: '联通云盘', WPS: 'WPS 云盘',
  YandexDisk: 'Yandex 网盘', cloudflare_imgbed: 'Cloudflare 图床',
}

export const fieldNames: Record<string, string> = {
  mount_path: '挂载路径', order: '排序权重', remark: '备注', cache_expiration: '缓存有效期（分钟）',
  custom_cache_policies: '自定义缓存规则', web_proxy: '网页代理', webdav_policy: 'WebDAV 策略', down_proxy_url: '下载代理地址',
  disable_proxy_sign: '关闭代理签名', extract_folder: '压缩包目录位置', disable_index: '禁止建立索引', enable_sign: '启用链接签名',
  order_by: '排序字段', order_direction: '排序方向', root_folder_id: '根目录 ID', root_folder_path: '根目录路径',
  username: '用户名', password: '密码', access_token: '访问令牌', refresh_token: '刷新令牌', token: '令牌',
  client_id: '客户端 ID', client_secret: '客户端密钥', ClientID: '客户端 ID', ClientSecret: '客户端密钥',
  AccessToken: '访问令牌', RefreshToken: '刷新令牌', cookie: 'Cookie', cookies: 'Cookies', qrcode_token: '二维码令牌',
  qrcode_source: '二维码登录设备', page_size: '每页数量', limit_rate: '请求速率限制', share_code: '分享码', receive_code: '提取码',
  family_id: '家庭 ID', sort_rule: '排序规则', directory_size: '计算目录大小', thumbnail: '生成缩略图',
  thumb_cache_folder: '缩略图缓存目录', thumb_concurrency: '缩略图并发数', video_thumb_pos: '视频缩略图位置',
  show_hidden: '显示隐藏文件', mkdir_perm: '新建目录权限', recycle_bin_path: '回收站路径', address: '服务地址',
  endpoint: '服务端点', bucket: '存储桶', region: '区域', api_key: 'API 密钥', secret_key: '访问密钥',
  use_online_api: '使用在线接口', api_url_address: '接口地址', upload_thread: '上传并发数', UploadThread: '上传并发数',
}

export const fieldHelp: Record<string, string> = {
  mount_path: '在 BMovie 中显示的目录位置，必须唯一，例如 /电影。', order: '数字越小越靠前。',
  cache_expiration: '目录列表在本地保留的时间。', root_folder_id: '服务商提供的根目录标识；通常保持默认即可。',
  root_folder_path: '需要挂载的远端或本地目录路径。', web_proxy: '通过 OpenList 转发网页端下载请求。',
  enable_sign: '为公开文件链接增加时效签名。', disable_index: '开启后媒体扫描将跳过此存储。',
  thumbnail: '允许驱动为图片和视频生成缩略图。', show_hidden: '是否显示以点号开头的文件。',
}
