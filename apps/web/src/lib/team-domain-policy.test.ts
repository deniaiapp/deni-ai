import { expect, test } from "vitest";
import {
  isSharedEmailDomain,
  normalizeTeamDomain,
  teamDomainTxtRecord,
  toTeamDomainJoinMode,
} from "./team-domain-policy";

test("domains are normalized from what people paste", () => {
  expect(normalizeTeamDomain(" @Example.COM. ")).toBe("example.com");
  expect(normalizeTeamDomain("mail.example.co.jp")).toBe("mail.example.co.jp");
  for (const input of ["", "localhost", "exa mple.com", "-bad.com", "example..com", "1.2.3.4"]) {
    expect(normalizeTeamDomain(input)).toBeNull();
  }
});

test("shared mail providers and bare educational suffixes cannot be claimed", () => {
  for (const domain of ["gmail.com", "outlook.com", "icloud.com", "duck.com", "ac.jp", "edu"]) {
    expect(isSharedEmailDomain(domain)).toBe(true);
  }
  for (const domain of ["deniai.app", "u-tokyo.ac.jp", "company.example"]) {
    expect(isSharedEmailDomain(domain)).toBe(false);
  }
});

test("join mode defaults to admin approval", () => {
  expect(toTeamDomainJoinMode(undefined)).toBe("request");
  expect(toTeamDomainJoinMode("unknown")).toBe("request");
  expect(toTeamDomainJoinMode("auto")).toBe("auto");
  expect(teamDomainTxtRecord("example.com", "abc")).toEqual({
    name: "_deni-ai-verification.example.com",
    value: "deni-ai-verification=abc",
  });
});
