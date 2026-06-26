/*
 * MqttPublisher — the publish seam for the live polygon-occupancy path.
 *
 * Phase 4 publishes one occupancy entity per polygon zone (and a device presence
 * entity) to Home Assistant over MQTT. That transport sits behind this small
 * interface, in the same seam style as the existing DataProvider/ZonesClient
 * providers: the runtime depends on `MqttPublisher`, the real implementation talks
 * to the broker, and a `FakeMqttPublisher` records messages for the test suite, so
 * no real broker is needed to verify the publish behaviour.
 *
 * The real client obtains the broker host, port and credentials from the
 * Supervisor MQTT service and connects with a retained last will on its
 * availability topic, so the entities show unavailable (rather than vanish) when
 * the add-on stops. mqtt is imported lazily so the dependency is only loaded when a
 * polygon device actually needs to publish.
 */
import type { Logger } from '../ha/HaWsClient'

export interface PublishOptions {
  retain?: boolean
  qos?: 0 | 1 | 2
}

export interface MqttPublisher {
  /** The bridge availability topic (carries online/offline and the last will). */
  readonly availabilityTopic: string
  /** True once connected and the online availability has been published. */
  readonly available: boolean
  /** Publish a message. Retain defaults to false. */
  publish(topic: string, payload: string, options?: PublishOptions): void
  /** Publish the offline availability and close the connection. */
  close(): Promise<void>
}

/** Builds a publisher for a given availability topic, or throws if MQTT is unavailable. */
export type MqttPublisherFactory = (availabilityTopic: string, logger?: Logger) => Promise<MqttPublisher>

const ONLINE = 'online'
const OFFLINE = 'offline'

// ---- fake (tests) ---------------------------------------------------------

export interface RecordedMessage {
  topic: string
  payload: string
  retain: boolean
  qos: number
}

/**
 * An in-memory publisher that records every message, used by the test suite in
 * place of a real broker. Constructed "connected": it publishes the online
 * availability immediately and exposes the configured last will for assertions.
 */
export class FakeMqttPublisher implements MqttPublisher {
  readonly availabilityTopic: string
  available = true
  readonly messages: RecordedMessage[] = []
  /** The last will a real client would register (topic + retained offline payload). */
  readonly lastWill: { topic: string; payload: string; retain: boolean }

  constructor(availabilityTopic = 'sense360zonestudio/status') {
    this.availabilityTopic = availabilityTopic
    this.lastWill = { topic: availabilityTopic, payload: OFFLINE, retain: true }
    // A connected publisher announces itself online (retained), like the real one.
    this.publish(availabilityTopic, ONLINE, { retain: true, qos: 1 })
  }

  publish(topic: string, payload: string, options: PublishOptions = {}): void {
    this.messages.push({ topic, payload, retain: !!options.retain, qos: options.qos ?? 0 })
  }

  async close(): Promise<void> {
    this.publish(this.availabilityTopic, OFFLINE, { retain: true, qos: 1 })
    this.available = false
  }

  // ---- assertion helpers -------------------------------------------------

  /** The most recent message published to a topic, or undefined. */
  last(topic: string): RecordedMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].topic === topic) return this.messages[i]
    }
    return undefined
  }

  /** Every payload published to a topic, in order. */
  payloads(topic: string): string[] {
    return this.messages.filter((m) => m.topic === topic).map((m) => m.payload)
  }
}

// ---- real (Supervisor MQTT service) ---------------------------------------

interface SupervisorMqttData {
  host: string
  port: number
  ssl?: boolean
  username?: string
  password?: string
  protocol?: string
}

/** Read the broker connection details the Supervisor grants via `services: mqtt:want`. */
async function fetchMqttService(supervisorBase: string, token: string): Promise<SupervisorMqttData> {
  const res = await fetch(`${supervisorBase}/services/mqtt`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Supervisor MQTT service unavailable (HTTP ${res.status})`)
  const body = (await res.json()) as { result?: string; data?: SupervisorMqttData }
  if (!body?.data?.host) throw new Error('Supervisor MQTT service returned no broker host')
  return body.data
}

/**
 * Connect to the broker the Supervisor grants and return a live publisher. Throws
 * when the MQTT service is not provided or the connection cannot be established, so
 * the caller can degrade to the canvas-preview-only path. Lazily imports mqtt.
 */
export const supervisorMqttFactory: MqttPublisherFactory = async (availabilityTopic, logger) => {
  const token = process.env.SUPERVISOR_TOKEN ?? ''
  const supervisorBase = process.env.SUPERVISOR_API ?? 'http://supervisor'
  const data = await fetchMqttService(supervisorBase, token)

  const { connect } = await import('mqtt')
  const protocol = data.ssl ? 'mqtts' : 'mqtt'
  const url = `${protocol}://${data.host}:${data.port}`

  const client = connect(url, {
    username: data.username,
    password: data.password,
    clientId: `sense360-zone-studio-${process.pid}`,
    will: { topic: availabilityTopic, payload: OFFLINE, retain: true, qos: 1 },
    reconnectPeriod: 5000,
  })

  return await new Promise<MqttPublisher>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.end(true)
      reject(new Error('MQTT broker connection timed out'))
    }, 10000)

    client.on('connect', () => {
      clearTimeout(timer)
      client.publish(availabilityTopic, ONLINE, { retain: true, qos: 1 })
      logger?.info({ url }, 'connected to the MQTT broker')
      resolve({
        availabilityTopic,
        get available() {
          return client.connected
        },
        publish(topic, payload, options = {}) {
          client.publish(topic, payload, { retain: options.retain ?? false, qos: options.qos ?? 0 })
        },
        async close() {
          await new Promise<void>((done) => {
            client.publish(availabilityTopic, OFFLINE, { retain: true, qos: 1 }, () => {
              client.end(false, {}, () => done())
            })
          })
        },
      })
    })

    client.on('error', (err) => {
      clearTimeout(timer)
      logger?.warn({ err: String(err) }, 'MQTT broker connection error')
      client.end(true)
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
}
