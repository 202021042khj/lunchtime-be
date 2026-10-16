import { detectImageType } from './image-type.js';

describe('detectImageType', () => {
  it('jpg · png · webp 시그니처', () => {
    expect(
      detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))?.ext,
    ).toBe('jpg');
    expect(
      detectImageType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
      )?.contentType,
    ).toBe('image/png');
    expect(
      detectImageType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))
        ?.ext,
    ).toBe('webp');
  });

  it('이름만 이미지인 HTML · GIF · 빈 파일은 거절', () => {
    expect(
      detectImageType(Buffer.from('<html><script>alert(1)</script>')),
    ).toBeNull();
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});
