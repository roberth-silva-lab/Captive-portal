import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PublicPortalExperience, attemptCaptivePortalClose } from './components/public-portal-experience'
import type { Method, PortalSettings, SessionStatus } from './types'

const settings: PortalSettings = {
  logoUrl: '/leaoreceita.png',
  primaryColor: '#176b87',
  bannerText: 'Portal de Acesso Wi-Fi',
  welcomeText: 'Acesso seguro para visitantes',
  successMessage: 'Acesso liberado.',
  expiredMessage: 'Sua sessão expirou.',
  networkName: 'WiFi Visitantes',
  establishmentName: 'Receita Federal',
  termsText: 'Ao continuar, você aceita os termos de uso da rede.',
  maintenanceMode: false,
  maintenance: { enabled: false, active: false, scheduled: false, title: '', message: '', startsAt: null, endsAt: null, imageUrl: '', visualConfig: {} },
  notifications: [],
  expirationWarningMinutes: [30, 10, 5],
  allowedAuthMethods: ['voucher', 'cpf', 'email'],
}

const session: SessionStatus = {
  status: 'authorized',
  authorized: true,
  authorizedAt: '2026-08-05T10:00:00Z',
  expiresAt: '2026-08-05T11:00:00Z',
  serverNow: '2026-08-05T10:00:00Z',
  remainingSeconds: 3600,
  remainingMinutes: 60,
  totalSeconds: 3600,
  ssid: 'WiFi Visitantes',
  nextCheckSeconds: 30,
}

let dom: JSDOM
let root: Root | null = null
let container: HTMLElement

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window as unknown as Window & typeof globalThis
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.Event = dom.window.Event
  globalThis.MouseEvent = dom.window.MouseEvent
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(window, 'matchMedia', { value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })), configurable: true })
  container = document.getElementById('root') as HTMLElement
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  dom.window.close()
})

const render = (element: React.ReactNode) => {
  act(() => {
    root = createRoot(container)
    root.render(element)
  })
}

const clickByText = (label: string) => {
  const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.includes(label))
  expect(button).toBeTruthy()
  act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

const changeInput = (selector: string, value: string) => {
  const input = container.querySelector(selector) as HTMLInputElement | null
  expect(input).toBeTruthy()
  act(() => {
    if (!input) return
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const baseProps = {
  settings,
  institutionName: 'Receita Federal',
  networkName: 'WiFi Visitantes',
  method: 'voucher' as Method,
  identifier: '',
  accepted: true,
  stage: 'idle' as const,
}

function PublicHarness({ initialMethod = 'voucher', initialName = '', initialIdentifier = '', initialPhone = '' }: { initialMethod?: Method; initialName?: string; initialIdentifier?: string; initialPhone?: string }) {
  const [method, setMethod] = useState<Method>(initialMethod)
  const [identifier, setIdentifier] = useState(initialIdentifier)
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [formInstanceKey, setFormInstanceKey] = useState(0)
  const clear = () => {
    setIdentifier('')
    setName('')
    setPhone('')
    setFormInstanceKey((value) => value + 1)
  }
  return <PublicPortalExperience {...baseProps} method={method} identifier={identifier} name={name} phone={phone} formInstanceKey={formInstanceKey} onSelectMethod={(selected) => { setMethod(selected); clear() }} onIdentifierChange={setIdentifier} onNameChange={setName} onPhoneChange={setPhone} />
}

describe('public portal production behavior', () => {
  it('does not render literal unicode escape sequences', () => {
    render(<PublicPortalExperience {...baseProps} accepted={false} termsOpen />)
    const unicodeNeedle = `${String.fromCharCode(92)}u00`
    expect(container.textContent).not.toContain(unicodeNeedle)
  })

  it('shows only voucher when the site policy allows only voucher', () => {
    render(<PublicPortalExperience {...baseProps} settings={{ ...settings, allowedAuthMethods: ['voucher'] }} />)
    expect(container.textContent).toContain('Voucher')
    expect(container.textContent).not.toContain('CPF')
    expect(container.textContent).not.toContain('E-mail')
  })

  it('does not show CPF helper text when CPF form opens', () => {
    render(<PublicHarness />)
    clickByText('CPF')
    expect(container.textContent).toContain('Nome completo')
    expect(container.textContent).toContain('Telefone opcional')
    expect(container.textContent).not.toContain('máscara será aplicada')
  })

  it('opens a new CPF form with personal fields empty', () => {
    render(<PublicHarness initialMethod="cpf" />)
    clickByText('CPF')
    const inputs = Array.from(container.querySelectorAll('input')) as HTMLInputElement[]
    expect(inputs.find((input) => input.id === 'visitor-name')?.value).toBe('')
    expect(inputs.find((input) => input.id === 'portal-identifier')?.value).toBe('')
    expect(inputs.find((input) => input.id === 'visitor-phone')?.value).toBe('')
  })

  it('clears personal data when switching away from CPF and opening it again', () => {
    render(<PublicHarness />)
    clickByText('CPF')
    changeInput('#visitor-name', 'Pessoa Teste')
    changeInput('#portal-identifier', '123.456.789-09')
    changeInput('#visitor-phone', '(11) 90000-0000')
    expect((container.querySelector('#visitor-name') as HTMLInputElement).value).toBe('Pessoa Teste')
    clickByText('Voltar')
    clickByText('Voucher')
    clickByText('Voltar')
    clickByText('CPF')
    expect((container.querySelector('#visitor-name') as HTMLInputElement).value).toBe('')
    expect((container.querySelector('#portal-identifier') as HTMLInputElement).value).toBe('')
    expect((container.querySelector('#visitor-phone') as HTMLInputElement).value).toBe('')
  })

  it('remounts a new session without personal data', () => {
    const { rerender } = (() => {
      const renderNode = (node: React.ReactNode) => act(() => root?.render(node))
      act(() => { root = createRoot(container) })
      return { rerender: renderNode }
    })()
    rerender(<PublicPortalExperience key="old" {...baseProps} method="cpf" identifier="123.456.789-09" name="Pessoa Teste" phone="(11) 90000-0000" formInstanceKey="old" />)
    clickByText('CPF')
    expect((container.querySelector('#visitor-name') as HTMLInputElement).value).toBe('Pessoa Teste')
    rerender(<PublicPortalExperience key="new" {...baseProps} method="cpf" identifier="" name="" phone="" formInstanceKey="new" />)
    clickByText('CPF')
    expect((container.querySelector('#visitor-name') as HTMLInputElement).value).toBe('')
    expect((container.querySelector('#portal-identifier') as HTMLInputElement).value).toBe('')
  })

  it('does not show success before the confirmed released stage', () => {
    render(<PublicPortalExperience {...baseProps} stage="checking" message="Verificando conexão" />)
    expect(container.textContent).not.toContain('Acesso liberado')
  })

  it('starts countdown and calls window.close after confirmed success', () => {
    vi.useFakeTimers()
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined)
    render(<PublicPortalExperience {...baseProps} stage="released" session={session} />)
    expect(container.textContent).toContain('Esta janela será fechada em 3 segundos.')
    expect(container.textContent).toContain('Continuar para a Internet')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(closeSpy).toHaveBeenCalledOnce()
  })

  it('keeps fallback available if window.close is blocked', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'close').mockImplementation(() => { throw new Error('blocked') })
    render(<PublicPortalExperience {...baseProps} stage="released" session={session} redirectUrl="https://example.org" />)
    act(() => { vi.advanceTimersByTime(3000) })
    expect(container.textContent).toContain('Se a janela não fechar automaticamente')
    expect(container.querySelector('a[href="https://example.org"]')?.textContent).toContain('Continuar para a Internet')
  })

  it('cancels the close timer when success screen unmounts', () => {
    vi.useFakeTimers()
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined)
    render(<PublicPortalExperience {...baseProps} stage="released" session={session} />)
    act(() => root?.unmount())
    root = null
    act(() => { vi.advanceTimersByTime(3000) })
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('schedules fallback redirect through the isolated close helper', () => {
    vi.useFakeTimers()
    const fakeWindow = { close: vi.fn(), setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window), location: { assign: vi.fn() } } as unknown as Window
    attemptCaptivePortalClose('https://example.org', fakeWindow)
    act(() => { vi.advanceTimersByTime(800) })
    expect(fakeWindow.close).toHaveBeenCalledOnce()
    expect(fakeWindow.location.assign).toHaveBeenCalledWith('https://example.org')
  })
})