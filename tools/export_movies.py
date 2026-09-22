# -*- coding: utf-8 -*-
"""从 影视记录表.xlsx 导出结构化 movies.json"""
import json
import os
import re
import datetime
import hashlib

import openpyxl

SRC = os.path.join(os.path.dirname(__file__), '..', '影视记录表.xlsx')
OUT = os.path.join(os.path.dirname(__file__), '..', 'movie-site', 'data', 'movies.json')

SPLIT = re.compile(r'[、,，/·|]+')


def clean(v):
    if v is None:
        return ''
    if isinstance(v, datetime.datetime):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, datetime.date):
        return v.strftime('%Y-%m-%d')
    return str(v).strip()


def multi(v):
    v = clean(v)
    if not v:
        return []
    return [x.strip() for x in SPLIT.split(v) if x.strip()]


def to_int(v):
    v = clean(v)
    m = re.search(r'\d+', v)
    return int(m.group()) if m else None


def hue_of(title):
    return int(hashlib.md5(title.encode('utf-8')).hexdigest()[:8], 16) % 360


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    header = [clean(x) for x in rows[0]]
    print('表头:', header)

    movies = []
    seen = set()
    for r in rows[1:]:
        d = dict(zip(header, r))
        title = clean(d.get('影视名'))
        if not title:
            continue
        premiere = clean(d.get('首播时间'))
        year = None
        m = re.search(r'(19|20)\d{2}', premiere)
        if m:
            year = int(m.group())
        key = (title, year)
        if key in seen:
            continue
        seen.add(key)

        summary = clean(d.get('剧情简介'))
        category = clean(d.get('影视分类')) or '未分类'
        movies.append({
            'title': title,
            'premiere': premiere,
            'year': year,
            'summary': summary,
            'category': category,
            'genres': multi(d.get('影视类型')),
            'country': multi(d.get('制片国家/地区')),
            'actors': clean(d.get('主演')),
            'actor_list': multi(d.get('主演')),
            'director': clean(d.get('导演')),
            'director_list': multi(d.get('导演')),
            'writer': clean(d.get('编剧')),
            'episodes': to_int(d.get('集数')) if category != '电影' else None,
            'watched': clean(d.get('是否看完')),
            'watch_time': clean(d.get('观看时间')),
            'hue': hue_of(title + premiere),
        })

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(movies, f, ensure_ascii=False, indent=1)

    cats = {}
    genres = {}
    countries = {}
    for m in movies:
        cats[m['category']] = cats.get(m['category'], 0) + 1
        countries[m['country'][0] if m['country'] else '未知'] = countries.get(m['country'][0] if m['country'] else '未知', 0) + 1
        for g in m['genres']:
            genres[g] = genres.get(g, 0) + 1
    print('导出条数:', len(movies))
    print('分类:', cats)
    print('国家TOP:', sorted(countries.items(), key=lambda x: -x[1])[:8])
    print('类型TOP:', sorted(genres.items(), key=lambda x: -x[1])[:15])
    print('输出:', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
