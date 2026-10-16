// 올린 파일이 실제로 이미지인지 첫 바이트(시그니처)로 확인한다.
// 브라우저가 보낸 Content-Type이나 파일 이름은 믿지 않는다 (HTML을 이미지라고 올리는 것을 막음)
export type ImageType = { ext: 'jpg' | 'png' | 'webp'; contentType: string };

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function detectImageType(buf: Buffer): ImageType | null {
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (
    buf.length >= 8 &&
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}
