import { describe, expect, it } from 'vitest'
import { applyPromptTemplate, parsePromptTemplate } from '../../src/shared/prompt-template'

describe('prompt template parameters', () => {
  it('recognizes required, optional, and option parameters in stable order', () => {
    expect(parsePromptTemplate('为{角色}制作[场景]，风格为[风格：电影写实/当代水墨]')).toEqual([
      { name: '角色', token: '{角色}', kind: 'required', options: [] },
      { name: '场景', token: '[场景]', kind: 'optional', options: [] },
      { name: '风格', token: '[风格：电影写实/当代水墨]', kind: 'select', options: ['电影写实', '当代水墨'] },
    ])
  })

  it('deduplicates repeated parameters and keeps the stricter definition', () => {
    expect(parsePromptTemplate('[主体]与{主体}，使用{镜头}，再次{镜头}')).toEqual([
      { name: '主体', token: '{主体}', kind: 'required', options: [] },
      { name: '镜头', token: '{镜头}', kind: 'required', options: [] },
    ])
  })

  it('ignores escaped markers, markdown links, image syntax, and JSON-like objects', () => {
    expect(parsePromptTemplate(String.raw`\{不是参数\} [文档](https://example.com) ![图片](https://example.com/a.png) {"size":"1024"}`)).toEqual([])
  })

  it('recognizes unnamed placeholders while preserving double-braced text', () => {
    expect(parsePromptTemplate('创作{}的画面，可选补充[]，保留{{普通文本}}')).toEqual([
      { name: '参数 1', token: '{}', kind: 'required', options: [] },
      { name: '参数 2', token: '[]', kind: 'optional', options: [] },
    ])

    expect(applyPromptTemplate('创作{}的画面，可选补充[]，保留{{普通文本}}', {
      '参数 1': '角色',
      '参数 2': '',
    })).toBe('创作角色的画面，可选补充，保留{普通文本}')
  })

  it('applies values to every occurrence and removes empty optional parameters cleanly', () => {
    expect(applyPromptTemplate('{主体}，[场景]，聚焦{主体}，[风格：写实/插画]', {
      主体: '红狐',
      场景: '',
      风格: '插画',
    })).toBe('红狐，聚焦红狐，插画')
  })

  it('restores escaped braces and brackets in the final prompt', () => {
    expect(applyPromptTemplate(String.raw`\{原样\} 与 \[保留\]，{主体}`, { 主体: '人像' })).toBe('{原样} 与 [保留]，人像')
  })

  it('recognizes YouMind argument placeholders and keeps their defaults', () => {
    const template = '背景为 {argument name="background color" default="柔和的紫蓝色渐变"}，标题为 {argument name="主标题" default="探索未来"}'

    expect(parsePromptTemplate(template)).toEqual([
      { name: 'background color', token: '{argument name="background color" default="柔和的紫蓝色渐变"}', kind: 'required', options: [], defaultValue: '柔和的紫蓝色渐变' },
      { name: '主标题', token: '{argument name="主标题" default="探索未来"}', kind: 'required', options: [], defaultValue: '探索未来' },
    ])
    expect(applyPromptTemplate(template, { 'background color': '纯白', 主标题: '新的标题' })).toBe('背景为 纯白，标题为 新的标题')
  })
})
