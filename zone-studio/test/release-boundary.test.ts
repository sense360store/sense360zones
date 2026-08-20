/*
 * Zone Studio is an optional, advanced radar-zone tool — never a setup step.
 *
 * SENSE360-REVIEW-RELEASE-001 (sense360zones#17) audited whether Zone Studio is a
 * dependency of the first reviewer journey and found that it is not: the add-on
 * reaches Home Assistant only after a user deliberately adds this third-party
 * repository, installs it and starts it, and a device's own entities come from its
 * firmware rather than from here.
 *
 * That boundary lives in prose, so it is easy to erode by accident. These tests pin
 * it: the customer-facing surfaces this repository owns must keep saying the add-on
 * is optional, must not start describing it as required, and the add-on manifest
 * must not promote it into Home Assistant's own startup. They assert nothing about
 * radar hardware, firmware behaviour or what any bundle supplies — those belong to
 * esphome-public and to SOT.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8')

const README = read('README.md')
const DOCS = read('zone-studio/DOCS.md')
const CONFIG = read('zone-studio/config.yaml')

describe('Zone Studio is presented as optional', () => {
  it('says so on the repository front door', () => {
    expect(README).toMatch(/Zone Studio is optional/)
  })

  it('says so in the user guide, which is where inbound links land', () => {
    expect(DOCS).toMatch(/Zone Studio is optional/)
  })

  it('states it before the guide asks anyone to install anything', () => {
    const optional = DOCS.indexOf('Zone Studio is optional')
    const install = DOCS.indexOf('## Installation')
    expect(optional).toBeGreaterThan(-1)
    expect(install).toBeGreaterThan(-1)
    expect(optional).toBeLessThan(install)
  })

  it('qualifies the front door before it says to install anything', () => {
    // README reaches a reviewer earlier than the guide does, so its own install
    // instruction must not stand unqualified above the optionality statement.
    // Compared on a re-wrap-independent copy: these files are hard wrapped.
    const flat = README.replace(/\s+/g, ' ')
    const install = flat.indexOf('install it, start it')
    expect(install).toBeGreaterThan(-1)
    expect(flat.slice(0, install)).toMatch(/optional/)
  })

  it('keeps the add-on discoverable rather than hiding it', () => {
    // Optional must not become invisible: the store route and the sidebar entry
    // are how an advanced user finds Zone Studio at all.
    expect(README).toMatch(/Add this repository to Home Assistant/)
    expect(DOCS).toMatch(/## Installation/)
    expect(CONFIG).toMatch(/^panel_title:/m)
    expect(CONFIG).toMatch(/^ingress: true$/m)
  })
})

describe('no customer-facing surface makes Zone Studio a requirement', () => {
  const surfaces: ReadonlyArray<readonly [string, string]> = [
    ['README.md', README],
    ['zone-studio/DOCS.md', DOCS],
  ]

  // Phrasings that would put the add-on on the critical path. Each is anchored on
  // Zone Studio / the add-on as the subject, so unrelated requirements stay legal:
  // the MQTT integration genuinely is required to publish polygon zone entities.
  const mandatoryPhrasings = [
    /(?:Zone Studio|[Tt]he add-on) is (?:required|mandatory|necessary)/,
    /(?:Zone Studio|[Tt]he add-on) is needed (?:to|before|for)/,
    /you (?:must|need to) (?:install|use|open) Zone Studio/,
    /(?:requires|needs) Zone Studio/,
    /Zone Studio (?:must|has to) be (?:installed|running|configured)/,
    // Anchored on the instruction, not on the words "before ... works", so that
    // stating the opposite ("nothing here has to be configured before a room
    // works") stays legal.
    /(?:configure|draw|set up) (?:your )?(?:zones|Zone Studio) (?:first|before)/i,
  ]

  for (const [name, text] of surfaces) {
    for (const pattern of mandatoryPhrasings) {
      it(`${name} does not say ${pattern}`, () => {
        expect(text).not.toMatch(pattern)
      })
    }
  }

  it('does not frame zone configuration as first-run setup', () => {
    for (const [, text] of surfaces) {
      expect(text).not.toMatch(/first[- ]run setup/i)
      expect(text).not.toMatch(/set up your zones (?:first|before)/i)
    }
  })
})

describe('the add-on manifest keeps Zone Studio out of Home Assistant startup', () => {
  /*
   * What actually keeps Zone Studio off the first-run path is that a user has to
   * add this third-party repository and install the add-on deliberately — no
   * manifest key grants or removes that. `boot` defaults to `auto` and `startup`
   * to `application`, so an installed add-on does start with Home Assistant; that
   * is ordinary add-on behaviour, not a setup requirement. What these tests pin is
   * narrower and real: the manifest must not promote Zone Studio into Home
   * Assistant's own startup or discovery.
   */
  it('starts after Home Assistant rather than as part of bringing it up', () => {
    // `initialize` starts the add-on on setup of Home Assistant; `system` and
    // `services` start before it. The default, `application`, starts afterwards.
    expect(CONFIG).not.toMatch(/^startup:\s*(initialize|system|services)\b/m)
  })

  it('does not advertise itself into Home Assistant discovery', () => {
    expect(CONFIG).not.toMatch(/^discovery:/m)
  })

  it('declares no service as a hard requirement', () => {
    // `mqtt:want` is a soft dependency: the add-on starts and the canvas works
    // without a broker. `mqtt:need` would make a broker a precondition.
    expect(CONFIG).toMatch(/mqtt:want/)
    expect(CONFIG).not.toMatch(/mqtt:need/)
  })
})
