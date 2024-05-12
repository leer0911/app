import { Button } from "@/components";
import styles from "./style.module.less";

/**
 * IAP 支付模式
 */
export function Apple() {
  return <Button className={styles.paymentIapButton}>立即支付</Button>;
}
