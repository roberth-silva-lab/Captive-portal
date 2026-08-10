import type { PortalAppearance, PreviewDevice, PreviewState } from '../types'
import { portalInstitutionName } from '../utils'
import { PublicPortalExperience } from './public-portal-experience'

export function PublicPortalPreview({ appearance, device, state = 'initial', noticeTitle = 'Aviso do portal', noticeMessage = 'Comunicado visível para esta unidade.', maintenanceTitle = 'Portal em manutenção', maintenanceMessage = 'Estamos realizando ajustes para melhorar o acesso.', maintenanceImageUrl = '' }: { appearance: PortalAppearance; device: PreviewDevice; state?: PreviewState; noticeTitle?: string; noticeMessage?: string; maintenanceTitle?: string; maintenanceMessage?: string; maintenanceImageUrl?: string }) {
  return <div className="public-preview-shell"><PublicPortalExperience
    settings={appearance}
    device={device}
    previewState={state}
    institutionName={portalInstitutionName(appearance.establishmentName)}
    networkName={appearance.networkName}
    method={state === 'cpf' ? 'cpf' : state === 'email' || state === 'code-sent' ? 'email' : 'voucher'}
    identifier=""
    emailCode={state === 'code-sent' ? '123456' : ''}
    accepted
    stage={state === 'released' ? 'released' : 'idle'}
    notices={state === 'notice' ? [{ id: 'preview-notice', type: 'INFO', title: noticeTitle, message: noticeMessage, site: 'ALL' }] : []}
    message={state === 'maintenance' ? maintenanceMessage : undefined}
    maintenanceTitle={maintenanceTitle}
    maintenanceMessage={maintenanceMessage}
    maintenanceImageUrl={maintenanceImageUrl}
  /></div>
}
