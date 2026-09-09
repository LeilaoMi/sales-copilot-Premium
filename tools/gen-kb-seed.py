#!/usr/bin/env python3
# 生成 kb/knowledge.json（军火库种子数据）
# 来源：① 旧项目 supabase/knowledge-seed.sql（约12条高质量知识型条目）
#       ② Operit 聊天记录归档里可提取的批量生成条目（尽力而为）
#       ③ hy4 内置48条话术【不收】—— 已在话术库，避免重复
import json, re, html, os, hashlib

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'kb', 'knowledge.json')
SEED_SQL = os.path.join(ROOT, '..', 'copilot-old', 'supabase', 'knowledge-seed.sql')
CHAT = r"D:/WeChat Files/wxid_oenwhe9q5qja22/FileStorage/File/2026-09/chat_backup_2026-09-09_12-27-43.json"

CAT_MAP = {
    'objection': '异议应对', 'script': '标准话术', 'competitor': '竞品对比',
    'knowledge': '实战经验', 'case': '成交案例', 'faq': '常见问答',
    'industry': '行业知识', 'process': '流程方法', 'method': '流程方法',
    'decision': '流程方法', 'other': '流程方法',
}

def sid(title):
    h = 5381
    for ch in str(title):
        h = ((h << 5) - h + ord(ch)) & 0xFFFFFFFF
    return 'kb-' + format(h if h < 2**31 else h - 2**32 + 2**32, 'x')

def unescape_sql(s):
    # E'...' 转义：\n 换行、\' 引号、\\ 反斜杠
    return (s.replace("\\'", "'").replace('\\n', '\n').replace('\\\\', '\\'))

items = []
seen_titles = set()

def add(title, category, content, tags, source):
    title = re.sub(r'\s+', ' ', str(title)).strip()
    content = str(content).strip()
    if not title or not content or title in seen_titles:
        return False
    seen_titles.add(title)
    items.append({
        'id': sid(title), 'title': title,
        'category': CAT_MAP.get(category, category or '实战经验'),
        'tags': tags, 'content': content, 'source': source,
    })
    return True

# ---------- ① 旧项目 seed.sql ----------
if os.path.exists(SEED_SQL):
    sql = open(SEED_SQL, encoding='utf-8').read()
    # 模式：('uuid', '标题', '分类', E'内容')
    pat = re.compile(r"\('[^']*',\s*'((?:[^']|\\')+)',\s*'(\w+)',\s*E'((?:[^']|\\')*)'\)", re.S)
    n0 = len(items)
    for m in pat.finditer(sql):
        title, cat, content = m.group(1), m.group(2), unescape_sql(m.group(3))
        # 标题里剥掉「XX：」前缀后的关键词做 tags
        kw = re.findall(r'[\u4e00-\u9fa5A-Za-z]{2,6}', title)
        add(title, cat, content, kw[:6], 'seed-v1')
    print(f'seed.sql 提取: {len(items)-n0} 条')

# ---------- ② 聊天记录提取 ----------
if os.path.exists(CHAT):
    with open(CHAT, encoding='utf-8') as fp:
        d = json.load(fp)
    msgs = d['chats'][0]['messages']
    n0 = len(items)
    for i, m in enumerate(msgs):
        c = html.unescape(str(m.get('baseMessage', {}).get('content', '')))
        if len(c) < 5000:
            continue
        # 找 E'...' 大段内容（批量生成的条目内容）
        # 以及 ('xxx', '标题', '分类', E'内容') 完整元组
        for m2 in re.finditer(r"\('(?:[^']*)',\s*'((?:[^']|\\') {0,0}[^']*)',\s*'(\w+)',\s*E'((?:[^']|\\')*)'\)", c):
            t, cat, content = m2.group(1), m2.group(2), unescape_sql(m2.group(3))
            if 6 < len(t) < 120 and len(content) > 80:
                kw = re.findall(r'[\u4e00-\u9fa5A-Za-z]{2,6}', t)
                add(t, cat, content, kw[:6], f'chat-extract#{i}')
    print(f'聊天记录提取: {len(items)-n0} 条')

# ---------- ③ 人工扩充的精品条目（kb-extra-*.json）----------
import glob
for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), 'kb-extra-*.json'))):
    n0 = len(items)
    extra = json.load(open(f, encoding='utf-8'))
    for x in extra:
        add(x.get('title', ''), x.get('category', '实战经验'),
            x.get('content', ''), x.get('tags', []), 'curated-v1')
    print(f'{os.path.basename(f)}: {len(items)-n0} 条')

# ---------- 输出 ----------
items.sort(key=lambda x: (x['category'], x['title']))
out = {
    'version': 1,
    'generatedAt': '2026-09-09',
    'notice': '条目由 AI 辅助整理生成，金额、案例、政策类说法使用前请按自己产品与客户实际情况核实。',
    'items': items,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as fp:
    json.dump(out, fp, ensure_ascii=False, indent=1)
cats = {}
for x in items:
    cats[x['category']] = cats.get(x['category'], 0) + 1
print(f'合计: {len(items)} 条 -> {OUT}')
print('分类分布:', json.dumps(cats, ensure_ascii=False))
