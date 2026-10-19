import { csvCell, maskEmail } from './admin-users.service.js';

describe('maskEmail', () => {
  it('앞 2글자만 남기고 도메인은 그대로', () => {
    expect(maskEmail('jimin@kakao.com')).toBe('ji***@kakao.com');
    expect(maskEmail('ab@x.com')).toBe('a***@x.com');
    expect(maskEmail('a@x.com')).toBe('a***@x.com');
    expect(maskEmail(null)).toBe('');
  });
});

describe('csvCell', () => {
  it('쉼표 · 따옴표 · 줄바꿈은 따옴표로 감싼다', () => {
    expect(csvCell('김지민')).toBe('김지민');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(12)).toBe('12');
  });

  it('엑셀 수식으로 읽힐 값은 앞에 따옴표 하나', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+82')).toBe("'+82");
    expect(csvCell('@me')).toBe("'@me");
  });
});
