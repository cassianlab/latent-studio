import { describe, expect, it } from 'vitest'
import { DocumentExtractionError, extractDocument } from '../../src/main/context/extractor'

function storedZip(entryName: string, content: string): Uint8Array {
  const name = Buffer.from(entryName, 'utf8')
  const data = Buffer.from(content, 'utf8')
  const local = Buffer.alloc(30 + name.length + data.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(0, 8)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  name.copy(local, 30)
  data.copy(local, 30 + name.length)

  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(0, 10)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  name.copy(central, 46)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(local.length, 16)
  return Buffer.concat([local, central, end])
}

describe('document extractor', () => {
  it('reads JSON as UTF-8 text', async () => {
    const result = await extractDocument('/project/notes.json', Buffer.from('{"scene": "雨夜"}', 'utf8'))
    expect(result).toEqual({ kind: 'json', mimeType: 'application/json', text: '{"scene": "雨夜"}' })
  })

  it('extracts text from a PDF text stream', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 16 >>\nstream\n(Hello PDF) Tj\nendstream\nendobj\n%%EOF', 'latin1')
    const result = await extractDocument('/project/scene.pdf', pdf)
    expect(result.kind).toBe('pdf')
    expect(result.mimeType).toBe('application/pdf')
    expect(result.text).toBe('Hello PDF')
  })

  it('extracts the document body from a DOCX archive', async () => {
    const docx = storedZip('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>第一段</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>')
    const result = await extractDocument('/project/script.docx', docx)
    expect(result.kind).toBe('word')
    expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(result.text).toBe('第一段\n第二段')
  })

  it('rejects a PDF without a readable text layer', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%%EOF', 'latin1')
    await expect(extractDocument('/project/scan.pdf', pdf)).rejects.toMatchObject<DocumentExtractionError>({ code: 'invalid-document' })
  })

  it('rejects invalid UTF-8 for text documents', async () => {
    await expect(extractDocument('/project/broken.txt', Buffer.from([0xc3, 0x28]))).rejects.toMatchObject({ code: 'invalid-utf8' })
  })
})
