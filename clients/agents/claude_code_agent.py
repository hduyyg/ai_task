#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ClaudeCodeAgent - Claude Code CLI Agent 封装
"""

import logging
import subprocess

from .base_agent import BaseAgent

logger = logging.getLogger(__name__)


class ClaudeCodeAgent(BaseAgent):
    """Claude Code CLI Agent，通过 claude -p 命令调用"""
    
    def __init__(self):
        super().__init__(name="Claude Code", timeout=1800)

    def _execute_prompt(self, trace_id: str, cwd: str, prompt: str, timeout: int) -> str:
        """
        调用 claude -p 命令执行 prompt
        
        Args:
            trace_id: 追踪标识，用于日志关联
            cwd: 工作目录
            timeout: 超时时间（秒）
            prompt: 要执行的 prompt
            
        Returns:
            Claude 的输出内容
        """
        try:
            result = subprocess.run(
                ['claude', '-p', prompt],
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd
            )            
            logger.info(f"[{trace_id}] [{self.name}] Claude Code Agent 调用完成，返回码: {result.returncode}")    
            return result.returncode == 0, result.stdout.strip()         
        except subprocess.TimeoutExpired:
            return False, f"[{trace_id}] [{self.name}] Claude Code Agent 调用超时 (timeout={self.timeout}s)"
        except FileNotFoundError:
            return False, f"[{trace_id}] [{self.name}] claude 命令未找到，请确保已安装 Claude CLI 工具"
        except Exception as e:
            return False, f"[{trace_id}] [{self.name}] Claude Code Agent 调用异常: {e}"
