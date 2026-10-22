import logoUrl from '../../../../../assets/brand/viva-icon.svg?no-inline'

interface Props {
  className?: string
  decorative?: boolean
}

export function VivaLogo({ className, decorative = false }: Props): JSX.Element {
  return <img src={logoUrl} className={className} alt={decorative ? '' : 'VIVA'} draggable={false} width={1024} height={1024} />
}
