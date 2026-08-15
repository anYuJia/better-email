import React from 'react';
import { logError } from '../app/logger';

type AppErrorBoundaryProps = {
  children: React.ReactNode;
  title?: string;
  description?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
};

type AppErrorBoundaryState = {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
};

export function errorSummary(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return '未知渲染错误';
}

export default class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    logError('[better-email][render-error]', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  reset = () => {
    this.setState({
      error: null,
      errorInfo: null,
    });
  };

  reload = () => {
    window.location.reload();
  };

  handlePrimaryAction = () => {
    this.reset();
    this.props.onPrimaryAction?.();
  };

  handleSecondaryAction = () => {
    if (this.props.onSecondaryAction) {
      this.props.onSecondaryAction();
      return;
    }
    this.reload();
  };

  render() {
    const {
      error,
      errorInfo,
    } = this.state;
    const {
      title = '界面没有崩掉，我们先把它接住了',
      description = '当前视图渲染失败，但本地数据没有被清空。你可以先重试当前界面；\n            如果仍然失败，再刷新应用。',
      primaryLabel = '重试界面',
      secondaryLabel = '刷新应用',
    } = this.props;
    if (!error) return this.props.children;

    return (
      <main className="app-error-boundary" role="alert" aria-live="assertive">
        <section className="app-error-card">
          <p className="app-error-eyebrow">Better Email 遇到一个界面错误</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <pre>{errorSummary(error)}</pre>
          {errorInfo?.componentStack ? (
            <details>
              <summary>查看组件堆栈</summary>
              <code>{errorInfo.componentStack.trim()}</code>
            </details>
          ) : null}
          <div className="app-error-actions">
            <button type="button" onClick={this.handlePrimaryAction}>
              {primaryLabel}
            </button>
            <button type="button" className="secondary" onClick={this.handleSecondaryAction}>
              {secondaryLabel}
            </button>
          </div>
        </section>
      </main>
    );
  }
}
