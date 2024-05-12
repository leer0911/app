import { Image } from '@/components/business';

export interface AvatarProps {
    /**
     * 头像图片地址
     */
    src?: string;

    /**
     * 头像点击事件
     */
    onClick?: (e?: React.MouseEvent<HTMLElement>) => void;
}

/**
 * 基础头像组件
 */
export function Avatar(props: AvatarProps) {
    const { src } = props;

    return <Image src={src} />;
}
