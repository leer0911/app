import { ImgHTMLAttributes } from 'react';

export interface ImageProps extends ImgHTMLAttributes<HTMLImageElement> {}

/**
 * 图片业务组件
 */
export function Image(props: ImageProps) {
    return <img {...props} />;
}
