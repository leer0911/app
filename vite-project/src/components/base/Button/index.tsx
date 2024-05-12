import { ButtonHTMLAttributes, PropsWithChildren } from "react";

import "./style.css";

/**
 * 基础按钮组件属性
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {}

/**
 * 基础按钮组件
 */
export function Button(props: PropsWithChildren<ButtonProps>) {
  const { children } = props;

  return <button className="button payment-button">{children}</button>;
}
