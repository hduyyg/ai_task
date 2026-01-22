#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
MinimaxAgent - Minimax Agent 封装（待实现）
"""

from .base_agent import BaseAgent


class MinimaxAgent(BaseAgent):
    """Minimax Agent（待实现）"""
    
    def _execute_prompt(self, trace_id: str, cwd: str, prompt: str, timeout: int) -> str:
        """
        执行 prompt（待实现）
        
        Args:
            trace_id: 追踪标识，用于日志关联
            cwd: 工作目录
            timeout: 超时时间（秒）
            prompt: 要执行的 prompt
            
        Raises:
            NotImplementedError: 该功能尚未实现
        """
        raise NotImplementedError("MinimaxAgent 尚未实现")
