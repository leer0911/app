import classNames from 'classnames';
import { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import styles from './style.module.less';

export enum ButtonVariant {
    /**
     * 默认
     */
    Outline = 'outline',

    /**
     * 主题色
     */
    Primary = 'primary',
}

/**
 * 基础按钮组件属性
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    /**
     * 按钮类型
     */
    variant?: ButtonVariant;
}

/**
 * 基础按钮组件
 */
export function Button(props: PropsWithChildren<ButtonProps>) {
    const { className, disabled, children, variant } = props;

    return (
        <button
            {...props}
            className={classNames(styles.button, className, {
                [styles.buttonDisabled]: disabled,
                [styles.buttonOutline]: variant === ButtonVariant.Outline,
            })}
        >
            {children}
        </button>
    );
}
